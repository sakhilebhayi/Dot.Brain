// services/brand-engine/src/analyze/adapters/common.js
//
// Shared by every adapter. An adapter turns the OUTPUT of an external tool
// (a file somebody else produced) into engine evidence. It never runs the
// tool, never touches the network and never executes anything it reads.
// Every adapter:
//   - parses strictly and throws AdapterError (a clear, bounded message) on
//     input that is not what it claims to be;
//   - reads only bytes that were already bounded by the caller;
//   - copies free text into the output only through safeText (control
//     characters removed, credential shapes redacted, length clipped);
//   - reports only counts and rule ids as numbers, never a raw report body.
import { REPORT_LIMITS, TEXT_LIMITS } from '../limits.js';
import { safeLocationString, safeText } from '../text.js';

export class AdapterError extends Error {
  constructor(adapter, file, message) {
    super(`${file}: ${adapter} report ${message}`);
    this.name = 'AdapterError';
    this.adapter = adapter;
    this.file = file;
  }
}

export const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Parse JSON with a bounded, clear failure. */
export function parseJson(adapter, file, text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new AdapterError(adapter, file, `is not valid JSON (${safeText(error.message, 120)})`);
  }
}

/** A path from a report, made relative to the checkout when it points inside it. */
export function relativeTo(root, file, sink) {
  const raw = String(file).replace(/\\/g, '/');
  const r = String(root).replace(/\\/g, '/').replace(/\/+$/, '');
  let rel = raw;
  if (raw === r) rel = '.';
  else if (raw.startsWith(`${r}/`)) rel = raw.slice(r.length + 1);
  else if (raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) rel = `external/${raw.slice(raw.lastIndexOf('/') + 1)}`;
  rel = rel.split('/').filter((p) => p !== '' && p !== '.' && p !== '..').join('/');
  return safeLocationString(rel || '.', TEXT_LIMITS.path, sink);
}

/** Pathname of a URL from a report with query, fragment and credentials removed; or a label. */
export function pageLabel(url, sink) {
  if (typeof url !== 'string' || url === '') return '(page)';
  try {
    const u = new URL(url);
    return safeLocationString(u.pathname === '/' ? `${u.host}/` : `${u.host}${u.pathname}`, TEXT_LIMITS.path, sink);
  } catch {
    return safeLocationString(url, TEXT_LIMITS.path, sink);
  }
}

/** A name safe to use as an artifact_ref (no whitespace). */
export const refName = (name) => safeText(name, 200).replace(/\s+/g, '_') || 'report';

export function cap(adapter, file, count, max, what) {
  if (count > max) throw new AdapterError(adapter, file, `has more than ${max} ${what}`);
}

export const LIMITS = REPORT_LIMITS;
