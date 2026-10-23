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

const PRIVATE_HOST = /^(?:localhost|.+\.(?:localhost|local|internal|test|lan|home\.arpa)|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|0\.0\.0\.0|\[?::1?\]?|\[?f[cd][0-9a-f:]*\]?|[^.]+)$/i;

/**
 * A report's `file` that is really a URL (the detector run against a page served locally, for example
 * `http://127.0.0.1:8801/_snap/x.html`) becomes an OPAQUE identifier, `url:<path>`: it is not a file of the
 * checkout and must not look like one. The scheme, credentials, port, query and fragment are dropped. The
 * host is dropped too when it is local or private (a loopback address, a single-label name, .local, .test,
 * a private range): it names a machine, not a page, and its port would publish where a dev server ran. A
 * public host is kept (without its port) because two pages of one path on different sites are different pages.
 * Returns null when `value` is not a URL, so the caller treats it as a path.
 */
export function urlIdentifier(value, sink) {
  const raw = String(value).trim();
  if (/^(?:data|blob|about|javascript|mailto):/i.test(raw)) return `url:(${raw.slice(0, raw.indexOf(':')).toLowerCase()})`;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return null;
  let u;
  try { u = new URL(raw); } catch { return 'url:(unreadable)'; }
  if (u.protocol === 'file:') return null; // a file URL is a local path: the caller makes it relative to the checkout
  const host = u.hostname.toLowerCase();
  const keepHost = host !== '' && !PRIVATE_HOST.test(host);
  const path = u.pathname === '' ? '/' : u.pathname;
  return safeLocationString(`url:${keepHost ? host : ''}${path}`, TEXT_LIMITS.path, sink);
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
