import { randomInt, createHash } from 'node:crypto';

const REST_URL = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').replace(/\/+$/, '');
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';

// An ID lives 90 days after the last time it was created, looked up by a launcher, or changed by the bot.
export const TTL_SECONDS = 90 * 24 * 60 * 60;

// Keep in sync with the launcher (BugReportTracker.cpp, MyReportsDialog.cpp) and the bot's REPORT_STATUSES.
export const STATUSES = [
  'received', 'seen', 'in_progress', 'need_info', 'cannot_reproduce', 'fixed_next', 'fixed',
  'planned', 'added', 'wont_fix', 'duplicate', 'not_a_bug', 'not_launcher',
];

// 31 characters, no 0/O/1/I/L (easy to misread). 31^10 is about 8e14 (~49 bits): not guessable.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ID_RE = /^[A-HJKMNP-Z2-9]{10}$/;

export const normalizeId = raw => String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const displayId = id => `${id.slice(0, 5)}-${id.slice(5)}`;

const key = id => `report:${id}`;

async function redis(commands) {
  if (!REST_URL || !REST_TOKEN) throw new Error('Report store is not configured');
  const res = await fetch(`${REST_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Report store answered ${res.status}`);
  return (await res.json()).map(r => {
    if (r.error) throw new Error(r.error);
    return r.result;
  });
}

/** Called by report.js for every accepted report. Returns the new 10-character ID. */
export async function createReport() {
  for (let attempt = 0; attempt < 5; attempt++) {
    let id = '';
    for (let i = 0; i < 10; i++) id += ALPHABET[randomInt(ALPHABET.length)];
    const value = JSON.stringify({ s: 'received', v: '', u: Date.now() });
    const [ok] = await redis([['SET', key(id), value, 'NX', 'EX', TTL_SECONDS]]); // NX: never reuse an existing ID
    if (ok === 'OK') return id;
  }
  throw new Error('Could not allocate a report ID');
}

/** Launcher lookup. Returns { ID: {status, version, updated} | null }. Reading renews the 90 days. */
export async function getStatuses(ids) {
  const results = await redis(ids.map(id => ['GETEX', key(id), 'EX', TTL_SECONDS]));
  const out = {};
  ids.forEach((id, i) => {
    try {
      const r = results[i] ? JSON.parse(results[i]) : null;
      // cooldown: epoch ms until which the launcher refuses new reports (0 = none). Set by the bot, see setCooldown().
      out[id] = r ? { status: r.s, version: r.v, updated: r.u, cooldown: Number(r.c) > Date.now() ? Number(r.c) : 0 } : null;
    } catch {
      out[id] = null;
    }
  });
  return out;
}

/** Bot update. Returns false when the ID does not exist (typo or expired). */
export async function setStatus(id, status, version) {
  const current = await readRecord(id);
  if (!current) return false;
  const record = { s: status, v: version || '', u: Date.now() };
  if (Number(current.c) > Date.now()) record.c = current.c; // a running cooldown survives a status change
  const [ok] = await redis([['SET', key(id), JSON.stringify(record), 'XX', 'EX', TTL_SECONDS]]); // XX: only if it exists
  return ok === 'OK';
}

async function readRecord(id) {
  const [raw] = await redis([['GET', key(id)]]);
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Bot: ask the launcher that sent this report to stop sending new ones for a while. Nothing about the sender is
 * stored: the launcher learns about it the next time it asks for its report statuses and then blocks itself.
 * Returns the end time in epoch ms, or null when the ID does not exist.
 */
export async function setCooldown(id, minutes) {
  const current = await readRecord(id);
  if (!current) return null;
  const until = Date.now() + minutes * 60 * 1000;
  current.c = until; // "u" stays as it was, so the reporter does not get a "your report was updated" toast
  const [ok] = await redis([['SET', key(id), JSON.stringify(current), 'XX', 'EX', TTL_SECONDS]]);
  return ok === 'OK' ? until : null;
}

/** Counts requests per IP in a time window. Returns false once the limit is passed. */
export async function underLimit(ip, limit, windowSeconds) {
  if (!REST_URL || !REST_TOKEN) return true; // no Redis: allow the lookup (IDs are unguessable anyway)
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const ipHash = createHash('sha256').update(ip).digest('hex').slice(0, 16); // never store raw IPs
  const k = `rl:status:${bucket}:${ipHash}`;
  const [count] = await redis([
    ['INCR', k],
    ['EXPIRE', k, String(windowSeconds + 10)],
  ]);
  return Number(count) <= limit;
}
