// services/brand-engine/src/score/util.js
//
// Numbers and hashes. Scores are reported TRUNCATED, never rounded up: a
// displayed 89.99 must not become 90.00 and read as a pass. Thresholds are
// compared on the untruncated value (to nine decimal places, to absorb binary
// floating point), so the displayed number can only ever be at or below it.
import { createHash } from 'node:crypto';
import { stableStringify } from '../json.js';

/** Round to nine decimals: removes binary floating-point noise, adds none. */
export const settle = (x) => Math.round(x * 1e9) / 1e9;

/** Truncate (toward zero) to `dp` decimals after settling. Never rounds up. */
export function trunc(x, dp) {
  const f = 10 ** dp;
  return Math.floor(settle(x) * f + 1e-6) / f;
}

export const sha256Hex = (text) => createHash('sha256').update(text).digest('hex');

/** sha256 of the canonical (sorted-key, compact) JSON, so formatting never changes a hash. */
export const canonicalHash = (value) => sha256Hex(stableStringify(value, 0));

export const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;

/** "Product Opens/Day" -> "product_opens_day" */
export const normaliseId = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
