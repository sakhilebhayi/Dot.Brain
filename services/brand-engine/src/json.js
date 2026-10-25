// services/brand-engine/src/json.js
import { lstatSync, readFileSync, statSync } from 'node:fs';

export const MAX_JSON_BYTES = 512 * 1024;

/** JSON with sorted object keys, so CLI output is byte-for-byte deterministic. */
export function stableStringify(value, space = 2) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]));
    }
    return v;
  };
  return JSON.stringify(sort(value), null, space);
}

/**
 * Read and parse a JSON file. Returns {ok:true, value} or {ok:false, error}.
 * `followSymlinks:false` (used for directory scans) refuses links, so a
 * scanned directory cannot be made to read a file outside itself.
 */
export function readJson(path, { followSymlinks = true } = {}) {
  let st;
  try {
    st = followSymlinks ? statSync(path) : lstatSync(path);
  } catch (error) {
    return { ok: false, error: `cannot read: ${error.code ?? error.message}` };
  }
  if (!st.isFile()) return { ok: false, error: 'not a regular file' };
  if (st.size > MAX_JSON_BYTES) return { ok: false, error: `larger than ${MAX_JSON_BYTES} bytes` };
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (error) {
    return { ok: false, error: `invalid JSON: ${error.message}` };
  }
}
