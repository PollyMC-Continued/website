// Report ID + status store. Files starting with "_" in /api are not exposed as routes by Vercel.
// Uses Upstash Redis over its REST API (Vercel Marketplace -> Upstash Redis). No dependencies.
import { randomInt } from 'node:crypto';

const REST_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

// An ID lives 90 days after the last time it was created, looked up by a launcher, or changed by the bot.
export const TTL_SECONDS = 90 * 24 * 60 * 60;

export const STATUSES = ['received', 'seen', 'need_info', 'fixed_next', 'fixed', 'wont_fix', 'duplicate', 'not_a_bug'];

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
      out[id] = r ? { status: r.s, version: r.v, updated: r.u } : null;
    } catch {
      out[id] = null;
    }
  });
  return out;
}

/** Bot update. Returns false when the ID does not exist (typo or expired). */
export async function setStatus(id, status, version) {
  const value = JSON.stringify({ s: status, v: version || '', u: Date.now() });
  const [ok] = await redis([['SET', key(id), value, 'XX', 'EX', TTL_SECONDS]]); // XX: only if it exists
  return ok === 'OK';
}
