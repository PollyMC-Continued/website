// PollyMC-Continued bug report relay (Vercel serverless function, ES module).
// Receives a report from the launcher's "Report a Bug" dialog and posts it as a plain message (no embed) through a
// Discord webhook. With a forum channel every report becomes its own thread titled "Bug: ...", "Suggestion: ...", etc.
// The webhook URL stays in an environment variable and never ships inside the launcher.
//
// Env vars:
//   DISCORD_WEBHOOK_URL   required. Channel > Edit > Integrations > Webhooks > Copy Webhook URL
//   DISCORD_FORUM         optional. "1"/"true" = webhook belongs to a forum channel, "0"/"false" = normal text channel.
//                         Leave it unset and the relay detects the channel type by itself (see sendReport).
//   DISCORD_PING_ROLE_ID  optional role id to ping on every report (the only mention the bot is allowed to make)
//
//   Abuse protection (all optional, safe defaults):
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN   shared counters + replay protection (Vercel's Upstash/KV
//                         integration sets KV_REST_API_URL / KV_REST_API_TOKEN, which are accepted as well).
//                         Without Redis the relay falls back to per-instance memory, which is much weaker.
//   REPORT_POW_BITS       proof-of-work difficulty in leading zero bits (default 20, ~1 s on a normal PC; 0 = off).
//                         The launcher's PowBits constant must be >= this value.
//   REPORT_REQUIRE_POW    "0" lets launchers that do not send a proof through (use only while old builds are around)
//   REPORT_IP_PER_HOUR    reports per IP per hour (default 5)
//   REPORT_GLOBAL_PER_HOUR  reports per hour across everybody (default 60); the hard ceiling for the Discord channel

import { createHash } from 'node:crypto';

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const PING_ROLE = /^\d{5,25}$/.test(process.env.DISCORD_PING_ROLE_ID || '') ? process.env.DISCORD_PING_ROLE_ID : '';

// true = forum channel, false = normal channel, null = not known yet (auto-detect on the first report).
// Kept at module level so a warm serverless instance only has to learn it once.
function parseForumEnv(value) {
  const v = String(value || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return null;
}
let forumMode = parseForumEnv(process.env.DISCORD_FORUM);

// Discord JSON error codes we react to.
const ERR_FORUM_NEEDS_THREAD = 220001; // "Webhooks posted to forum channels must have a thread_name or thread_id"
const ERR_NOT_A_FORUM = 220003; // "Webhooks can only create threads in forum channels"

const MAX_DESCRIPTION = 4000;
const MESSAGE_LIMIT = 1900; // Discord caps a message at 2000 characters; follow-ups keep some headroom
const MIN_DESCRIPTION = 10;
const MAX_NAME = 40;
const MAX_CONTACT = 80;
const MAX_SHOTS = 3;
const MAX_SHOT_BYTES = 1.5 * 1024 * 1024;
const MAX_LOG_CHARS = 200000;

const TYPES = {
  bug: { label: 'Bug' },
  crash: { label: 'Crash' },
  feature: { label: 'Suggestion' },
  other: { label: 'Other' },
};

// ---------------------------------------------------------------------------------------------------------------
// Abuse protection. A public client can never keep a secret, so instead of hiding the endpoint we make every
// report cost something and cap the total. Layers, outermost first:
//   1. Vercel Firewall rate limit on /api/report (set in the dashboard, runs before this code and costs nothing).
//   2. Proof of work: each report carries a small computation bound to its own text, so spam costs CPU per message.
//   3. Single use: a solved proof can never be replayed (stored in Redis for as long as it would be accepted).
//   4. Per-IP and global hourly caps in Redis, shared by every serverless instance.
// ---------------------------------------------------------------------------------------------------------------
function intEnv(name, fallback, min, max) {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').replace(/\/+$/, '');
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const REDIS_ON = Boolean(REDIS_URL && REDIS_TOKEN);

const POW_BITS = intEnv('REPORT_POW_BITS', 20, 0, 28);
const REQUIRE_POW = POW_BITS > 0 && parseForumEnv(process.env.REPORT_REQUIRE_POW) !== false;
const POW_WINDOW_S = 600; // a proof is accepted if its timestamp is within +-10 minutes of the server clock
const POW_REPLAY_TTL_S = POW_WINDOW_S * 2 + 60; // long enough that a proof can never be reused while still valid
const IP_LIMIT = intEnv('REPORT_IP_PER_HOUR', 5, 1, 1000);
const GLOBAL_LIMIT = intEnv('REPORT_GLOBAL_PER_HOUR', 60, 1, 100000);
const HOUR_S = 3600;

if (!REDIS_ON) console.warn('No Redis configured: rate limits and replay protection only work per serverless instance.');

// Redis over Upstash's REST API (no dependency needed). Throws on any failure so callers fail closed.
async function redis(commands) {
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`Redis -> ${res.status}`);
  const data = await res.json();
  return data.map((entry) => {
    if (entry.error) throw new Error(`Redis -> ${entry.error}`);
    return entry.result;
  });
}

// Per-instance fallback used only when Redis is not configured.
const mem = new Map(); // key -> { n, exp }
function memEntry(key) {
  const now = Date.now();
  if (mem.size > 5000) for (const [k, v] of mem) if (v.exp <= now) mem.delete(k);
  const e = mem.get(key);
  return e && e.exp > now ? e : null;
}

// True the first time a key is seen within ttl seconds, false afterwards.
async function claimOnce(key, ttl) {
  if (REDIS_ON) return (await redis([['SET', key, '1', 'NX', 'EX', String(ttl)]]))[0] === 'OK';
  if (memEntry(key)) return false;
  mem.set(key, { n: 1, exp: Date.now() + ttl * 1000 });
  return true;
}

// Increments a counter that expires after ttl seconds and returns the new value.
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

// The launcher searches for a nonce so that
//   SHA-256("<powTime>:<powNonce>:<hex SHA-256 of the description>")
// starts with POW_BITS zero bits. The proof is tied to the report text, so it cannot be reused for another message,
// and powTime keeps old proofs from being stockpiled.
function checkPow(b, description) {
  const ts = Number(b.powTime);
  const nonce = typeof b.powNonce === 'string' || typeof b.powNonce === 'number' ? String(b.powNonce) : '';
  if (!Number.isSafeInteger(ts) || !/^\d{1,20}$/.test(nonce)) {
    return { ok: false, status: 400, error: 'This launcher version is too old to send reports. Please update it.' };
  }
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > POW_WINDOW_S) {
    return { ok: false, status: 400, error: "Your computer's clock looks wrong. Fix the date and time and try again." };
  }
  const digest = sha256(Buffer.from(description, 'utf8')).toString('hex');
  const hash = sha256(`${ts}:${nonce}:${digest}`);
  if (leadingZeroBits(hash) < POW_BITS) {
    return { ok: false, status: 400, error: 'Invalid proof of work.' };
  }
  return { ok: true, id: hash.toString('hex') };
}

// Vercel sets these itself and overwrites whatever the client sent; x-forwarded-for is only a fallback.
function clientIp(req) {
  const h = req.headers;
  const raw = h['x-vercel-forwarded-for'] || h['x-real-ip'] || h['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  return String(raw).split(',')[0].trim();
}

// Returns null when the request may go on, otherwise { status, error }.
async function guardRequest(b, description, ip) {
  if (REQUIRE_POW || b.powTime !== undefined || b.powNonce !== undefined) {
    const pow = checkPow(b, description);
    if (!pow.ok) return pow;
    if (!(await claimOnce(`pow:${pow.id}`, POW_REPLAY_TTL_S))) {
      return { status: 409, error: 'This report was already received.' };
    }
  }
  // Counters only move for requests that solved the proof, so garbage traffic cannot use up the global budget.
  const bucket = Math.floor(Date.now() / (HOUR_S * 1000));
  const ipKey = `rl:ip:${bucket}:${sha256(ip).toString('hex').slice(0, 16)}`;
  if ((await bump(ipKey, HOUR_S + 100)) > IP_LIMIT) {
    return { status: 429, error: 'Too many reports from your network, please try again later.' };
  }
  if ((await bump(`rl:global:${bucket}`, HOUR_S + 100)) > GLOBAL_LIMIT) {
    return { status: 503, error: 'Reports are paused for a moment because too many came in. Please try again later.' };
  }
  return null;
}

// One-line fields: no newlines, no characters that would turn into markdown links.
function oneLine(text, max) {
  return String(text || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[`<>[\]]/g, '')
    .trim()
    .slice(0, max);
}
function str(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}
function clip(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text;
}

// Name and contact are typed by the user; stop them from turning into bold/italic/spoilers in the report.
function escapeMd(text) {
  return text.replace(/([\\*_~|>])/g, '\\$1');
}

// Split long text on line/word boundaries so every piece fits in one Discord message.
function splitText(text, max) {
  const parts = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf(' ', max);
    if (cut < max / 2) cut = max;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

function webhookEndpoint(threadId) {
  const url = new URL(WEBHOOK_URL);
  url.searchParams.set('wait', 'true'); // makes Discord return the created message, so we know it really worked
  if (threadId) url.searchParams.set('thread_id', threadId); // post into an existing forum thread
  return url.toString();
}

async function postToDiscord(payload, files = [], threadId = '') {
  const build = () => {
    const form = new FormData();
    form.append('payload_json', JSON.stringify(payload));
    files.forEach((f, i) => form.append(`files[${i}]`, new Blob([f.data], { type: f.type }), f.name));
    return form;
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(webhookEndpoint(threadId), { method: 'POST', body: build() });
    if (res.status === 429 && attempt === 0) {
      // Discord rate limit: wait the advertised time (capped) and try once more.
      const data = await res.json().catch(() => ({}));
      await new Promise((r) => setTimeout(r, Math.min(Math.ceil((data.retry_after || 1) * 1000), 3000)));
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`Discord webhook -> ${res.status} ${data.message || ''}`.trim());
      err.status = res.status;
      err.code = data.code; // Discord's own error code, e.g. 220001
      throw err;
    }
    return data;
  }
  const err = new Error('Discord webhook -> rate limited');
  err.status = 429;
  throw err;
}

// Sends the first message of a report. Works for both normal channels and forum channels:
//  - forum known (env or learned earlier): send with thread_name right away
//  - otherwise: send as a normal message; if Discord answers 220001 the channel is a forum,
//    so remember that and resend once with thread_name
//  - if we guessed forum but Discord answers 220003 the channel is a normal one, so resend without it
// Returns { message, threaded } where threaded says whether a new forum thread was created.
async function sendReport(payload, files, threadName) {
  const attempt = (asThread) =>
    postToDiscord(asThread ? { ...payload, thread_name: threadName } : payload, files).then((message) => ({
      message,
      threaded: asThread,
    }));

  const first = forumMode === true;
  try {
    return await attempt(first);
  } catch (err) {
    if (!first && err.code === ERR_FORUM_NEEDS_THREAD) {
      forumMode = true;
      console.warn('Webhook belongs to a forum channel; switching to thread mode (set DISCORD_FORUM=1 to skip this check).');
      return attempt(true);
    }
    if (first && err.code === ERR_NOT_A_FORUM) {
      forumMode = false;
      console.warn('Webhook is not a forum channel; switching to plain messages (check DISCORD_FORUM).');
      return attempt(false);
    }
    throw err;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }
  if (!/^https:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/i.test(WEBHOOK_URL)) {
    console.error('DISCORD_WEBHOOK_URL is missing or malformed');
    return res.status(500).json({ error: 'Report server is not configured.' });
  }

  let b = req.body;
  if (typeof b === 'string') {
    try {
      b = JSON.parse(b);
    } catch {
      b = null;
    }
  }
  if (!b || typeof b !== 'object') return res.status(400).json({ error: 'Invalid request.' });

  const rawDescription = typeof b.description === 'string' ? b.description : '';
  if (rawDescription.length > MAX_DESCRIPTION * 2) return res.status(400).json({ error: 'The description is too long.' });
  const description = str(b.description, MAX_DESCRIPTION).trim();
  if (description.length < MIN_DESCRIPTION) return res.status(400).json({ error: 'Please describe the problem a bit more.' });

  // Abuse protection (proof of work, replay check, shared rate limits). If the counter store is down we refuse
  // the report instead of letting everything through.
  try {
    const blocked = await guardRequest(b, rawDescription, clientIp(req));
    if (blocked) return res.status(blocked.status).json({ error: blocked.error });
  } catch (err) {
    console.error(`Abuse protection failed: ${err.message}`);
    return res.status(503).json({ error: 'Reports are temporarily unavailable. Please try again later.' });
  }

  const type = TYPES[b.type] ? b.type : 'bug'; // older launchers don't send a type
  const meta = TYPES[type];
  const name = oneLine(b.name, MAX_NAME) || 'Anonymous';
  const contact = oneLine(b.contact, MAX_CONTACT);
  const version = oneLine(b.launcherVersion, 40) || 'unknown';
  const platform = oneLine(b.platform, 40) || 'unknown';
  const system = oneLine(b.system, 80) || 'unknown';
  const arch = oneLine(b.arch, 20) || 'unknown';
  const qt = oneLine(b.qt, 20) || 'unknown';

  // Attachments. Screenshots must decode to a real JPEG (the launcher always sends JPEG) and stay small.
  const files = [];
  for (const raw of Array.isArray(b.screenshots) ? b.screenshots.slice(0, MAX_SHOTS) : []) {
    if (typeof raw !== 'string' || raw.length > MAX_SHOT_BYTES * 1.4) continue;
    const buf = Buffer.from(raw, 'base64');
    if (buf.length > MAX_SHOT_BYTES || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) continue;
    files.push({ name: `screenshot-${files.length + 1}.jpg`, type: 'image/jpeg', data: buf });
  }
  const shotCount = files.length;
  const log = str(b.log, MAX_LOG_CHARS);
  if (log) files.push({ name: 'launcher-log.txt', type: 'text/plain', data: Buffer.from(log, 'utf8') });

  // Thread titles must not be empty, so fall back to something sensible if sanitising ate the whole line.
  const firstLine = oneLine(description.split(/\r?\n/)[0], 80) || 'New report';

  // Plain message, no embed. Example:
  //   **Name:** Anonymous
  //   **Contact:** Didn't leave one
  //   **Launcher:** 9.4.1 (windows) | **System:** Windows 11 | **CPU / Qt:** x86_64 / Qt 6.8
  //   **Attached:** 2 screenshots, launcher log
  const attached = [
    shotCount ? `${shotCount} screenshot${shotCount === 1 ? '' : 's'}` : '',
    log ? 'launcher log' : '',
  ].filter(Boolean);
  const header = [
    `**Name:** ${escapeMd(name)}`,
    `**Contact:** ${contact ? escapeMd(contact) : "Didn't leave one"}`,
    `**Launcher:** ${version} (${platform})`,
    `**System:** ${system}`,
    `**CPU / Qt:** ${arch} / Qt ${qt}`,
    `**Attached:** ${attached.length ? attached.join(', ') : 'nothing'}`,
    '',
    '**Description**',
  ].join('\n');

  // The first message carries the header, as much of the description as fits, and the attachments.
  // Whatever does not fit goes into follow-up messages in the same thread.
  const pingLine = PING_ROLE ? `<@&${PING_ROLE}> new ${meta.label.toLowerCase()} report\n` : '';
  const room = 1990 - pingLine.length - header.length - 1;
  const firstPart = splitText(description, room)[0];
  const first = `${header}\n${firstPart}`;
  const pieces = splitText(description.slice(firstPart.length).trimStart(), MESSAGE_LIMIT);

  const payload = {
    username: 'PollyMC Reports',
    content: clip(pingLine + first, 2000),
    flags: 4, // SUPPRESS_EMBEDS: links the user typed do not unfurl into previews
    // Nothing the user typed may ping anybody. Only the configured role (if any) is allowed through.
    allowed_mentions: PING_ROLE ? { parse: [], roles: [PING_ROLE] } : { parse: [] },
  };
  const threadName = clip(`${meta.label}: ${firstLine}`, 100);

  let message;
  let threaded;
  try {
    ({ message, threaded } = await sendReport(payload, files, threadName));
  } catch (err) {
    console.error(err.message);
    const busy = err.status === 429;
    return res.status(busy ? 503 : 502).json({ error: 'Could not send the report right now. Please try again later.' });
  }

  // The report itself is delivered at this point. If a follow-up part fails we log it but still answer 201:
  // telling the launcher "failed" would make the user resend and create a duplicate thread.
  // In a forum the created message lives in the new thread, whose id is the message's channel_id.
  const threadId = threaded ? message.channel_id : '';
  try {
    for (const piece of pieces) {
      await postToDiscord(
        { username: payload.username, content: clip(piece, 2000), flags: 4, allowed_mentions: { parse: [] } },
        [],
        threadId
      );
    }
  } catch (err) {
    console.error(`Follow-up part failed after the report was posted: ${err.message}`);
  }
  return res.status(201).json({ ok: true, id: message.id });
}
