import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// GET  /api/translations-admin  — list pending translation suggestions, or
//   fetch a single submission with full suggestions via ?id=<id>.
// POST /api/translations-admin  —
//   { action: 'login', secret, fingerprint? } -> set HttpOnly signed session cookie
//   { action: 'logout' }                      -> clear session cookie
//   { id?, reject?: false }                   -> accept submission. With GITHUB_TRANSLATIONS_TOKEN it is pushed to the
//                                                translations repo (a workflow opens the PR) and returned with `_pr`;
//                                                without it, it is popped and returned as LFJSON
//   { id, reject: true }                      -> reject and remove submission from queue
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
const LOGIN_FAIL_LIMIT = 3;
const LOGIN_FAIL_WINDOW_S = 30 * 60; // 30 minutes

// --- GitHub hand-off (optional) ------------------------------------------------
// When GITHUB_TRANSLATIONS_TOKEN is set, accepting a submission pushes it to the
// translations repo as branch `submission/<lang>-<id>` containing
// submissions/<lang>-<id>.json. The repo's "Apply website submission" workflow
// then patches <lang>.ts, validates it and opens a pull request.
// Token: fine-grained PAT limited to the translations repo, "Contents: write".
const GH_TOKEN = process.env.GITHUB_TRANSLATIONS_TOKEN || '';
const GH_REPO = process.env.GITHUB_TRANSLATIONS_REPO || 'PollyMC-Continued/translations';
const GH_BASE = process.env.GITHUB_TRANSLATIONS_BASE || 'main';
const GH_ON = Boolean(GH_TOKEN);

async function gh(path, init = {}) {
  const { allowStatus = [], ...fetchInit } = init;
  const res = await fetch(`https://api.github.com/repos/${GH_REPO}${path}`, {
    ...fetchInit,
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'pollymc-website-translations',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok && !allowStatus.includes(res.status)) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub ${fetchInit.method || 'GET'} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  }
  return res;
}

async function queueForPullRequest(entry) {
  if (!/^[A-Za-z0-9_@-]{1,30}$/.test(entry.lang) || !/^[a-z0-9-]{1,40}$/.test(entry.id)) {
    throw new Error('Unsafe language code or id for a branch name.');
  }
  const branch = `submission/${entry.lang}-${entry.id}`;
  const file = `submissions/${entry.lang}-${entry.id}.json`;

  const base = await (await gh(`/git/ref/heads/${encodeURIComponent(GH_BASE)}`)).json();
  await gh('/git/refs', {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: base.object.sha }),
  });
  try {
    // A separate push event from the ref creation, so the workflow sees the file.
    await gh(`/contents/${file}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Queue website submission ${entry.id} (${entry.lang})`,
        content: Buffer.from(JSON.stringify(entry, null, 2), 'utf8').toString('base64'),
        branch,
      }),
    });
  } catch (err) {
    await gh(`/git/refs/heads/${branch}`, { method: 'DELETE', allowStatus: [404, 422] }).catch(() => {});
    throw err;
  }
  return { branch, url: `https://github.com/${GH_REPO}/tree/${branch}` };
}

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

function failKeys(ipHash, fpHash) {
  return [`rl:tr:admin_fail:ip:${ipHash}`, `rl:tr:admin_fail:fp:${fpHash}`];
}

async function getLockStatus(ipHash, fpHash) {
  const keys = failKeys(ipHash, fpHash);
  if (REDIS_ON) {
    const res = await redis([
      ['GET', keys[0]],
      ['TTL', keys[0]],
      ['GET', keys[1]],
      ['TTL', keys[1]],
    ]);
    const c0 = Number(res[0] || 0);
    const t0 = Number(res[1] || 0);
    const c1 = Number(res[2] || 0);
    const t1 = Number(res[3] || 0);
    const locked = c0 >= LOGIN_FAIL_LIMIT || c1 >= LOGIN_FAIL_LIMIT;
    const retryAfter = Math.max(c0 >= LOGIN_FAIL_LIMIT ? t0 : 0, c1 >= LOGIN_FAIL_LIMIT ? t1 : 0);
    return { locked, retryAfter: retryAfter > 0 ? retryAfter : LOGIN_FAIL_WINDOW_S };
  }
  const now = Date.now();
  let locked = false;
  let retryAfter = 0;
  for (const k of keys) {
    const cur = memFails.get(k);
    if (cur && cur.exp > now && cur.n >= LOGIN_FAIL_LIMIT) {
      locked = true;
      retryAfter = Math.max(retryAfter, Math.ceil((cur.exp - now) / 1000));
    }
  }
  return { locked, retryAfter: retryAfter || LOGIN_FAIL_WINDOW_S };
}

async function bumpFailKeys(ipHash, fpHash) {
  const keys = failKeys(ipHash, fpHash);
  if (REDIS_ON) {
    const res = await redis([
      ['INCR', keys[0]],
      ['EXPIRE', keys[0], String(LOGIN_FAIL_WINDOW_S)],
      ['INCR', keys[1]],
      ['EXPIRE', keys[1], String(LOGIN_FAIL_WINDOW_S)],
    ]);
    const maxCount = Math.max(Number(res[0] || 0), Number(res[2] || 0));
    return maxCount;
  }
  const now = Date.now();
  let maxCount = 0;
  for (const k of keys) {
    const cur = memFails.get(k);
    const entry = cur && cur.exp > now ? cur : { n: 0, exp: now + LOGIN_FAIL_WINDOW_S * 1000 };
    entry.n += 1;
    entry.exp = now + LOGIN_FAIL_WINDOW_S * 1000;
    memFails.set(k, entry);
    if (entry.n > maxCount) maxCount = entry.n;
  }
  return maxCount;
}

async function clearFailKeys(ipHash, fpHash) {
  const keys = failKeys(ipHash, fpHash);
  if (REDIS_ON) {
    await redis([['DEL', keys[0], keys[1]]]);
    return;
  }
  for (const k of keys) memFails.delete(k);
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

function deviceFingerprintHash(req, body) {
  const h = req.headers || {};
  const clientFp = typeof body?.fingerprint === 'string'
    ? body.fingerprint.slice(0, 128)
    : String(h['x-device-fingerprint'] || '').slice(0, 128);
  const serverSignals = [
    h['user-agent'] || '',
    h['accept-language'] || '',
    h['sec-ch-ua'] || '',
    h['sec-ch-ua-platform'] || '',
    clientFp,
  ].join('|');
  return sha256(serverSignals).toString('hex').slice(0, 24);
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
    const fpHash = deviceFingerprintHash(req, body);

    try {
      const status = await getLockStatus(ipHash, fpHash);
      if (status.locked) {
        return res.status(429).json({
          error: 'Too many failed attempts. Locked for 30 minutes.',
          locked: true,
          retryAfter: status.retryAfter,
        });
      }
    } catch (err) {
      console.error(`Login rate-limit check failed: ${err.message}`);
    }

    const given = typeof body.secret === 'string' ? body.secret : '';
    if (!given || !constantTimeEquals(given, secret)) {
      let attempts = 1;
      try {
        attempts = await bumpFailKeys(ipHash, fpHash);
      } catch {
        // ignore rate-limit write errors
      }
      if (attempts >= LOGIN_FAIL_LIMIT) {
        return res.status(429).json({
          error: 'Too many failed attempts. Locked for 30 minutes.',
          locked: true,
          retryAfter: LOGIN_FAIL_WINDOW_S,
        });
      }
      const remaining = Math.max(0, LOGIN_FAIL_LIMIT - attempts);
      return res.status(401).json({
        error: `Wrong pass (${remaining} ${remaining === 1 ? 'try' : 'tries'} left).`,
        remaining,
      });
    }

    try {
      await clearFailKeys(ipHash, fpHash);
    } catch {
      // non-fatal
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
        const entry = JSON.parse(matchRaw);

        // Hand off to GitHub first: if it fails the submission stays in the queue.
        let pr = null;
        if (GH_ON) {
          try {
            pr = await queueForPullRequest(entry);
          } catch (err) {
            console.error(`GitHub hand-off failed: ${err.message}`);
            return res.status(502).json({ error: 'Could not hand the submission to GitHub. It is still in the queue.' });
          }
        }

        const [removed] = await redis([['LREM', 'tr:queue', '1', matchRaw]]);
        if (!removed) return res.status(409).json({ error: 'Submission was already processed.' });
        return res.status(200).json(pr ? { ...entry, _pr: pr } : entry);
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
