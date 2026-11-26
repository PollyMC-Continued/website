import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// GET  /api/translations-admin  — list pending translation suggestions, or
//   fetch a single submission with full suggestions via ?id=<id>.
// POST /api/translations-admin  —
//   { action: 'login', secret }  -> set HttpOnly signed session cookie
//   { action: 'logout' }         -> clear session cookie
//   { id?, reject?: false }      -> accept (pop) submission and return LFJSON
//   { id, reject: true }         -> reject and remove submission from queue
//
// Supports both Authorization: Bearer <TRANSLATION_BOT_SECRET> (for curl/CLI)
// and an HMAC-signed HttpOnly, SameSite=Strict session cookie (for the hidden
// admin UI).

const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').replace(/\/+$/, '');
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const REDIS_ON = Boolean(REDIS_URL && REDIS_TOKEN);

const COOKIE_NAME = 'pollymc_tr_admin';
const SESSION_TTL_S = 12 * 60 * 60; // 12 hours
const MAX_LIST = 200;
const LOGIN_FAIL_LIMIT = 5;
const LOGIN_FAIL_WINDOW_S = 15 * 60;

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

// Per-instance fallback for failed login rate-limiting when Redis is absent.
const memFails = new Map();
async function checkAndBumpLoginFail(ipHash) {
  const key = `rl:tr:admin_fail:${ipHash}`;
  if (REDIS_ON) {
    const count = Number((await redis([['INCR', key], ['EXPIRE', key, String(LOGIN_FAIL_WINDOW_S)]]))[0]);
    return count > LOGIN_FAIL_LIMIT;
  }
  const now = Date.now();
  const cur = memFails.get(key);
  const entry = cur && cur.exp > now ? cur : { n: 0, exp: now + LOGIN_FAIL_WINDOW_S * 1000 };
  entry.n += 1;
  memFails.set(key, entry);
  return entry.n > LOGIN_FAIL_LIMIT;
}

async function isLoginRateLimited(ipHash) {
  const key = `rl:tr:admin_fail:${ipHash}`;
  if (REDIS_ON) {
    const [val] = await redis([['GET', key]]);
    return Number(val || 0) >= LOGIN_FAIL_LIMIT;
  }
  const cur = memFails.get(key);
  return Boolean(cur && cur.exp > Date.now() && cur.n >= LOGIN_FAIL_LIMIT);
}

function sha256(data) {
  return createHash('sha256').update(data).digest();
}

function constantTimeEquals(a, b) {
  return timingSafeEqual(sha256(String(a)), sha256(String(b)));
}

function clientIp(req) {
  const h = req.headers;
  const raw = h['x-vercel-forwarded-for'] || h['x-real-ip'] || h['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  return String(raw).split(',')[0].trim();
}

function parseCookies(req) {
  const out = {};
  const raw = String(req.headers.cookie || '');
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function signSession(exp, secret) {
  const sig = createHmac('sha256', secret).update(`tr-admin:${exp}`).digest('hex');
  return `${exp}.${sig}`;
}

function verifySession(token, secret) {
  if (typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const expStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isSafeInteger(exp) || exp <= Math.floor(Date.now() / 1000)) return false;
  const expected = createHmac('sha256', secret).update(`tr-admin:${expStr}`).digest('hex');
  return constantTimeEquals(sig, expected);
}

function setSessionCookie(res, req, value, maxAge) {
  const isHttps = req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/api/translations-admin',
    `Max-Age=${maxAge}`,
  ];
  if (isHttps) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function getAuthMethod(req) {
  const secret = process.env.TRANSLATION_BOT_SECRET;
  if (!secret) return null;

  const auth = String(req.headers.authorization || '');
  if (/^Bearer\s+/i.test(auth)) {
    const given = auth.replace(/^Bearer\s+/i, '');
    if (constantTimeEquals(given, secret)) return 'bearer';
    return null;
  }

  const cookies = parseCookies(req);
  if (cookies[COOKIE_NAME] && verifySession(cookies[COOKIE_NAME], secret)) {
    return 'cookie';
  }
  return null;
}

function checkCsrf(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try {
      const u = new URL(origin);
      if (u.host !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body.' });
    }
  }
  if (!body || typeof body !== 'object') body = {};

  // Handle login / logout before requiring auth
  if (req.method === 'POST' && body.action === 'login') {
    if (!checkCsrf(req)) return res.status(403).json({ error: 'Forbidden.' });
    const secret = process.env.TRANSLATION_BOT_SECRET;
    if (!secret) return res.status(500).json({ error: 'Admin secret is not configured on the server.' });

    const ipHash = sha256(clientIp(req)).toString('hex').slice(0, 16);
    try {
      if (await isLoginRateLimited(ipHash)) {
        return res.status(429).json({ error: 'Too many failed attempts. Wait 15 minutes and try again.' });
      }
    } catch (err) {
      console.error(`Login rate-limit check failed: ${err.message}`);
    }

    const given = typeof body.secret === 'string' ? body.secret : '';
    if (!given || !constantTimeEquals(given, secret)) {
      try {
        await checkAndBumpLoginFail(ipHash);
      } catch {
        // ignore rate-limit write errors
      }
      return res.status(401).json({ error: 'Invalid admin key.' });
    }

    const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
    setSessionCookie(res, req, signSession(exp, secret), SESSION_TTL_S);
    return res.status(200).json({ ok: true, expiresIn: SESSION_TTL_S });
  }

  if (req.method === 'POST' && body.action === 'logout') {
    if (!checkCsrf(req)) return res.status(403).json({ error: 'Forbidden.' });
    setSessionCookie(res, req, '', 0);
    return res.status(200).json({ ok: true });
  }

  const authMethod = getAuthMethod(req);
  if (!authMethod) return res.status(401).json({ error: 'Not authorized.' });
  if (authMethod === 'cookie' && req.method !== 'GET' && !checkCsrf(req)) {
    return res.status(403).json({ error: 'Forbidden.' });
  }

  if (!REDIS_ON) {
    return res.status(500).json({ error: 'Queue store is not configured. Set UPSTASH_REDIS_REST_URL/TOKEN.' });
  }

  try {
    if (req.method === 'GET') {
      const targetId = typeof req.query?.id === 'string' ? req.query.id : '';
      const raw = await redis([['LRANGE', 'tr:queue', '0', String(MAX_LIST - 1)], ['LLEN', 'tr:queue']]);
      const entries = raw[0].map((s) => JSON.parse(s));

      if (targetId) {
        const match = entries.find((e) => e.id === targetId);
        if (!match) return res.status(404).json({ error: 'Submission not found.' });
        return res.status(200).json(match);
      }

      return res.status(200).json({
        total: raw[1],
        entries: entries.map((e) => ({
          id: e.id,
          lang: e.lang,
          name: e.name,
          contact: e.contact,
          received: e.received,
          strings: Array.isArray(e.suggestions) ? e.suggestions.length : 0,
        })),
      });
    }

    if (req.method === 'POST') {
      const action = body.reject || body.action === 'reject' ? 'reject' : 'accept';
      const targetId = typeof body.id === 'string' ? body.id.trim() : '';

      if (action === 'accept') {
        if (!targetId) {
          // Backward-compatible FIFO pop for curl scripts.
          const [raw] = await redis([['LPOP', 'tr:queue']]);
          if (!raw) return res.status(204).end();
          return res.status(200).json(JSON.parse(raw));
        }

        const [rawList] = await redis([['LRANGE', 'tr:queue', '0', '-1']]);
        const matchRaw = rawList.find((s) => {
          try {
            return JSON.parse(s).id === targetId;
          } catch {
            return false;
          }
        });
        if (!matchRaw) return res.status(404).json({ error: 'Submission not found in queue.' });
        const [removed] = await redis([['LREM', 'tr:queue', '1', matchRaw]]);
        if (!removed) return res.status(409).json({ error: 'Submission was already processed.' });
        return res.status(200).json(JSON.parse(matchRaw));
      }

      // Reject by id: locate exact serialized entry and remove it from the list.
      if (!targetId) return res.status(400).json({ error: 'id required to reject.' });
      const [rawList] = await redis([['LRANGE', 'tr:queue', '0', '-1']]);
      const matchRaw = rawList.find((s) => {
        try {
          return JSON.parse(s).id === targetId;
        } catch {
          return false;
        }
      });
      if (!matchRaw) return res.status(404).json({ error: 'Submission not found in queue.' });
      const [removed] = await redis([['LREM', 'tr:queue', '1', matchRaw]]);
      if (!removed) return res.status(409).json({ error: 'Submission was already processed.' });
      return res.status(200).json({ ok: true, id: targetId });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'GET/POST only' });
  } catch (err) {
    console.error(`Queue operation failed: ${err.message}`);
    return res.status(502).json({ error: 'Queue operation failed.' });
  }
}
