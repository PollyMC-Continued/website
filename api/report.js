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

// Best-effort rate limit. Serverless instances don't share memory, so this only slows down
// casual spam; for real protection add Vercel's WAF rate limiting on /api/report.
const PER_IP_LIMIT = 5;
const WINDOW_MS = 60 * 60 * 1000;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= PER_IP_LIMIT) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return false;
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

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (rateLimited(ip)) return res.status(429).json({ error: 'Too many reports, please try again later.' });

  let b = req.body;
  if (typeof b === 'string') {
    try {
      b = JSON.parse(b);
    } catch {
      b = null;
    }
  }
  if (!b || typeof b !== 'object') return res.status(400).json({ error: 'Invalid request.' });

  const description = str(b.description, MAX_DESCRIPTION).trim();
  if (description.length < MIN_DESCRIPTION) return res.status(400).json({ error: 'Please describe the problem a bit more.' });

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
