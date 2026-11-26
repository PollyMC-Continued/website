import { createHash } from 'node:crypto';

// POST /api/translations — anonymous translation suggestions for the web editor
// at /translation/editor/. The editor never writes to GitHub: suggestions are
// validated, stored in a queue (Redis when configured), and a maintainer turns
// approved ones into a pull request in the translations repository, where CI
// (validate.py + check_diff.py) runs again. This endpoint cannot create PRs, so
// anonymous users can never write to any repository.
//
// Abuse protection mirrors api/report.js:
//   1. Proof of work bound to the submission body (garbage traffic costs CPU).
//   2. Single-use proofs (a solved proof cannot be replayed).
//   3. Per-IP and global hourly caps in Redis (per-instance memory fallback).
//   4. Hard input limits: max 60 strings per submission, 4000 chars each.

const MAX_STRINGS_PER_SUBMISSION = 60;
const MAX_STRING_CHARS = 4000;
const MAX_PENDING_PER_IP = 25; // strings, not submissions
const MAX_NAME = 60;
const MAX_CONTACT = 80;
const LANG_RE = /^[\w@.-]{1,30}$/;

const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').replace(/\/+$/, '');
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const REDIS_ON = Boolean(REDIS_URL && REDIS_TOKEN);

const POW_BITS = 20;
const POW_WINDOW_S = 600;
const POW_REPLAY_TTL_S = POW_WINDOW_S * 2 + 60;
const IP_LIMIT = 20; // submissions per hour per IP
const GLOBAL_LIMIT = 200; // submissions per hour total
const PENDING_TTL_S = 30 * 24 * 60 * 60; // queue entries live 30 days
const HOUR_S = 3600;

if (!REDIS_ON) console.warn('No Redis configured: rate limits, replay protection and the queue only work per serverless instance.');

// ------------------------------------------------------------- redis helpers
async function redis(commands) {
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`Redis -> ${res.status}`);
  return (await res.json()).map((entry) => {
    if (entry.error) throw new Error(`Redis -> ${entry.error}`);
    return entry.result;
  });
}

const mem = new Map(); // key -> { n, exp }
function memEntry(key) {
  const now = Date.now();
  if (mem.size > 5000) for (const [k, v] of mem) if (v.exp <= now) mem.delete(k);
  const e = mem.get(key);
  return e && e.exp > now ? e : null;
}

async function claimOnce(key, ttl) {
  if (REDIS_ON) return (await redis([['SET', key, '1', 'NX', 'EX', String(ttl)]]))[0] === 'OK';
  if (memEntry(key)) return false;
  mem.set(key, { n: 1, exp: Date.now() + ttl * 1000 });
  return true;
}

async function bump(key, ttl) {
  if (REDIS_ON) return Number((await redis([['INCR', key], ['EXPIRE', key, String(ttl)]]))[0]);
  const e = memEntry(key) || { n: 0, exp: Date.now() + ttl * 1000 };
  e.n += 1;
  mem.set(key, e);
  return e.n;
}

function sha256(data) {
  return createHash('sha256').update(data).digest();
}

function leadingZeroBits(buf) {
  let bits = 0;
  for (const byte of buf) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

// SHA-256("<powTime>:<powNonce>:<hex SHA-256 of the body>") must start with POW_BITS zero bits.
// The proof is bound to this exact submission, so it cannot be reused for another one.
function checkPow(b, body) {
  const ts = Number(b.powTime);
  const nonce = typeof b.powNonce === 'string' || typeof b.powNonce === 'number' ? String(b.powNonce) : '';
  if (!Number.isSafeInteger(ts) || !/^\d{1,20}$/.test(nonce)) {
    return { ok: false, status: 400, error: 'Please reload the editor and try again.' };
  }
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > POW_WINDOW_S) {
    return { ok: false, status: 400, error: "Your computer's clock looks wrong. Fix the date and time and try again." };
  }
  const digest = sha256(Buffer.from(body, 'utf8')).toString('hex');
  const hash = sha256(`${ts}:${nonce}:${digest}`);
  if (leadingZeroBits(hash) < POW_BITS) return { ok: false, status: 400, error: 'Invalid proof of work.' };
  return { ok: true, id: hash.toString('hex') };
}

function clientIp(req) {
  const h = req.headers;
  const raw = h['x-vercel-forwarded-for'] || h['x-real-ip'] || h['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  return String(raw).split(',')[0].trim();
}

// Same oneLine rules as report.js: no newlines, no markdown/link characters.
function oneLine(text, max) {
  return String(text || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[`<>[\]]/g, '')
    .trim()
    .slice(0, max);
}

// ------------------------------------------------------------- validation
// The editor sends { index, base, texts } per string. Everything is re-checked
// here; the client is never trusted. `base` is what the user started from, so
// a maintainer can see (and resolve) races between submissions.
function validateBody(b) {
  if (!b || typeof b !== 'object') return { status: 400, error: 'Invalid request.' };
  if (typeof b.lang !== 'string' || !LANG_RE.test(b.lang)) return { status: 400, error: 'Unknown language.' };

  const name = oneLine(b.name, MAX_NAME);
  if (name.length < 2) return { status: 400, error: 'A name (2-60 characters) is required so you can be credited.' };
  const contact = oneLine(b.contact, MAX_CONTACT);

  if (!Array.isArray(b.suggestions)) return { status: 400, error: 'Nothing to submit.' };
  if (b.suggestions.length === 0) return { status: 400, error: 'Nothing to submit.' };
  if (b.suggestions.length > MAX_STRINGS_PER_SUBMISSION) {
    return { status: 400, error: `Too many strings at once (max ${MAX_STRINGS_PER_SUBMISSION}). Submit in parts.` };
  }

  const seen = new Set();
  for (const s of b.suggestions) {
    if (!s || typeof s !== 'object') return { status: 400, error: 'Malformed submission.' };
    const idx = Number(s.index);
    if (!Number.isSafeInteger(idx) || idx < 0 || idx >= 100000 || seen.has(idx)) {
      return { status: 400, error: 'Malformed submission.' };
    }
    seen.add(idx);
    if (!Array.isArray(s.base) || !Array.isArray(s.texts) || s.base.length !== s.texts.length || s.texts.length === 0 || s.texts.length > 6) {
      return { status: 400, error: 'Malformed submission.' };
    }
    for (const t of s.texts) {
      if (typeof t !== 'string' || t.length > MAX_STRING_CHARS) {
        return { status: 400, error: 'A translation is too long (max 4000 characters).' };
      }
    }
  }
  return { name, contact, lang: b.lang };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }

  let b = req.body;
  if (typeof b === 'string') {
    try {
      b = JSON.parse(b);
    } catch {
      b = null;
    }
  }

  // The PoW digest is computed over the suggestions only (not name/contact),
  // so re-checking it after parsing is exact.
  const powPayload = b && typeof b === 'object' ? JSON.stringify(b.suggestions ?? '') : '';
  const checked = validateBody(b);
  if (checked.status) return res.status(checked.status).json({ error: checked.error });

  try {
    const pow = checkPow(b, powPayload);
    if (!pow.ok) return res.status(pow.status).json({ error: pow.error });
    if (!(await claimOnce(`pow:${pow.id}`, POW_REPLAY_TTL_S))) {
      return res.status(409).json({ error: 'This submission was already received.' });
    }
  } catch (err) {
    console.error(`Abuse protection failed: ${err.message}`);
    return res.status(503).json({ error: 'Submissions are temporarily unavailable. Please try again later.' });
  }

  try {
    const bucket = Math.floor(Date.now() / (HOUR_S * 1000));
    const ipHash = sha256(clientIp(req)).toString('hex').slice(0, 16);
    if ((await bump(`rl:tr:ip:${bucket}:${ipHash}`, HOUR_S + 100)) > IP_LIMIT) {
      return res.status(429).json({ error: 'Too many submissions from your network, please try again later.' });
    }
    if ((await bump(`rl:tr:global:${bucket}`, HOUR_S + 100)) > GLOBAL_LIMIT) {
      return res.status(503).json({ error: 'Submissions are paused for a moment because too many came in. Please try again later.' });
    }

    // Pending budget per IP: a single address cannot fill the whole queue.
    const pendingKey = `tr:pending:${ipHash}`;
    if ((await bump(pendingKey, PENDING_TTL_S)) > MAX_PENDING_PER_IP * b.suggestions.length) {
      return res.status(429).json({ error: 'You have many suggestions waiting for review already. Please wait until they are processed.' });
    }
  } catch (err) {
    console.error(`Rate limiting failed: ${err.message}`);
    return res.status(503).json({ error: 'Submissions are temporarily unavailable. Please try again later.' });
  }

  // Store the submission in the queue. With Redis this survives across
  // serverless instances for 30 days; without it the queue lives only in this
  // instance's memory, which is why Redis is strongly recommended here.
  const entry = {
    id: sha256(`${Date.now()}:${powPayload}`).toString('hex').slice(0, 12),
    lang: checked.lang,
    name: checked.name,
    contact: checked.contact,
    received: new Date().toISOString(),
    suggestions: b.suggestions,
  };

  if (REDIS_ON) {
    try {
      await redis([['RPUSH', 'tr:queue', JSON.stringify(entry)], ['EXPIRE', 'tr:queue', PENDING_TTL_S]]);
    } catch (err) {
      console.error(`Queue write failed: ${err.message}`);
      return res.status(503).json({ error: 'Submissions are temporarily unavailable. Please try again later.' });
    }
  } else {
    const q = mem.get('tr:queue') || { n: [], exp: 0 };
    q.n.push(JSON.stringify(entry));
    mem.set('tr:queue', q);
  }

  return res.status(201).json({ ok: true, queued: b.suggestions.length });
}
