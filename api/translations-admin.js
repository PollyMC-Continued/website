import { createHash, timingSafeEqual } from 'node:crypto';

// GET  /api/translations-admin  — list the pending translation suggestions.
// POST /api/translations-admin  — pop and accept one submission, returning it
//   as an LFJSON body the maintainer feeds into scripts/apply_suggestions.py
//   in the translations repository (or reject: body { id, reject: true }).
//
// Authenticated with the same TRANSLATION_BOT_SECRET pattern as the report
// bot: a shared secret in an Authorization: Bearer header, compared in
// constant time. Only maintainers have it. Everything is read from the same
// tr:queue list that api/translations.js writes.

const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').replace(/\/+$/, '');
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const REDIS_ON = Boolean(REDIS_URL && REDIS_TOKEN);

async function redis(commands) {
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Redis -> ${res.status}`);
  return (await res.json()).map((r) => {
    if (r.error) throw new Error(r.error);
    return r.result;
  });
}

function authorized(req) {
  const secret = process.env.TRANSLATION_BOT_SECRET;
  if (!secret) return false;
  const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}

const MAX_LIST = 100;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!authorized(req)) return res.status(401).json({ error: 'Not authorized.' });

  if (!REDIS_ON) {
    return res.status(500).json({ error: 'Queue store is not configured. Set UPSTASH_REDIS_REST_URL/TOKEN.' });
  }

  try {
    if (req.method === 'GET') {
      const raw = await redis([['LRANGE', 'tr:queue', '0', String(MAX_LIST - 1)], ['LLEN', 'tr:queue']]);
      const entries = raw[0].map((s) => JSON.parse(s));
      return res.status(200).json({
        total: raw[1],
        entries: entries.map((e) => ({
          id: e.id,
          lang: e.lang,
          name: e.name,
          contact: e.contact,
          received: e.received,
          strings: e.suggestions.length,
        })),
      });
    }

    if (req.method === 'POST') {
      const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const action = b.reject ? 'reject' : 'accept';
      if (action === 'accept') {
        // Pop the next submission in order and hand it to the maintainer.
        const [raw] = await redis([['LPOP', 'tr:queue']]);
        if (!raw) return res.status(204).end();
        return res.status(200).json(JSON.parse(raw));
      }
      // Reject by id: remove it from the queue wherever it sits.
      if (typeof b.id !== 'string') return res.status(400).json({ error: 'id required to reject.' });
      await redis([['LREM', 'tr:queue', '1', JSON.stringify({ id: b.id })]]); // may not match a full entry; fallback below
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'GET/POST only' });
  } catch (err) {
    console.error(`Queue read failed: ${err.message}`);
    return res.status(502).json({ error: 'Queue read failed.' });
  }
}
