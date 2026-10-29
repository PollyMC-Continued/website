// GET  /api/status?ids=ID1,ID2   -> launcher asks for the status of its own reports (max 20 IDs)
// POST /api/status               -> PollyBot sets a status (Authorization: Bearer REPORT_BOT_SECRET)
import { createHash, timingSafeEqual } from 'node:crypto';
import { STATUSES, ID_RE, normalizeId, getStatuses, setStatus, underLimit } from './_reportStore.js';

function clientIp(req) {
  const h = req.headers;
  const raw = h['x-vercel-forwarded-for'] || h['x-real-ip'] || h['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  return String(raw).split(',')[0].trim();
}

function botAuthorized(req) {
  const secret = process.env.REPORT_BOT_SECRET;
  if (!secret) return false;
  const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  // hash both sides so the comparison has equal lengths and takes constant time
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      // 30 lookups per minute per IP. Launchers check once on startup, so normal users never reach this.
      if (!(await underLimit(clientIp(req), 30, 60))) {
        return res.status(429).json({ ok: false, error: 'Too many lookups. Try again in a minute.' });
      }
      const ids = [...new Set(String(req.query.ids || '').split(',').slice(0, 20).map(normalizeId))].filter(id => ID_RE.test(id));
      if (!ids.length) return res.status(400).json({ ok: false, error: 'No valid report IDs.' });
      // Only the status code and version are ever returned, never the report text, name or contact.
      return res.status(200).json({ ok: true, statuses: await getStatuses(ids) });
    }

    if (req.method === 'POST') {
      if (!botAuthorized(req)) return res.status(401).json({ ok: false, error: 'Unauthorized.' });
      let body = req.body;
      try {
        if (typeof body === 'string') body = JSON.parse(body);
      } catch {
        return res.status(400).json({ ok: false, error: 'Invalid JSON.' });
      }
      const id = normalizeId(body?.id);
      const status = String(body?.status || '');
      const version = String(body?.version || '').trim().replace(/^v/i, '');
      if (!ID_RE.test(id)) return res.status(400).json({ ok: false, error: 'Invalid report ID.' });
      if (!STATUSES.includes(status)) return res.status(400).json({ ok: false, error: 'Unknown status.' });
      if (status === 'fixed' && !/^\d[0-9A-Za-z.+_-]{0,23}$/.test(version)) {
        return res.status(400).json({ ok: false, error: '"fixed" needs a version.' });
      }
      const found = await setStatus(id, status, status === 'fixed' ? version : '');
      return found ? res.status(200).json({ ok: true }) : res.status(404).json({ ok: false, error: 'Unknown report ID.' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  } catch (e) {
    console.error('status endpoint failed:', e.message);
    return res.status(500).json({ ok: false, error: 'Server error.' });
  }
}
