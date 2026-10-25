// services/infodot-knowledge/src/hmac.js
//
// The ecosystem's server-to-server signing scheme (InfoDot's, reused for the
// Memory outcomes read):
//
//   X-InfoDot-Timestamp: <unix seconds>
//   X-InfoDot-Signature: sha256=<hex HMAC-SHA256(secret, "{timestamp}.{body}")>
//
// A GET has no body, so it signs "{timestamp}." (note the trailing dot).
// The receiver accepts a 300 second window either side of its own clock.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const TIMESTAMP_HEADER = 'X-InfoDot-Timestamp';
export const SIGNATURE_HEADER = 'X-InfoDot-Signature';
export const WINDOW_SECONDS = 300;

/** @returns {string} `sha256=<hex>` */
export function sign(secret, timestamp, body = '') {
  if (typeof secret !== 'string' || secret === '') {
    throw new Error('HMAC secret is empty');
  }
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

/** Headers for one signed request. `now` is a Date or ms; seconds are floored. */
export function signedHeaders(secret, { now = Date.now(), body = '' } = {}) {
  const timestamp = Math.floor(Number(now instanceof Date ? now.getTime() : now) / 1000);
  return {
    [TIMESTAMP_HEADER]: String(timestamp),
    [SIGNATURE_HEADER]: sign(secret, timestamp, body),
  };
}

/** Receiver-side check, kept for symmetry and tests: constant time, 300 s window. */
export function verify(secret, { timestamp, signature, body = '', now = Date.now() }) {
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || typeof signature !== 'string') return false;
  const nowS = Math.floor(Number(now instanceof Date ? now.getTime() : now) / 1000);
  if (Math.abs(nowS - ts) > WINDOW_SECONDS) return false;

  const expected = Buffer.from(sign(secret, ts, body));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
