// services/brand-engine/src/analyze/text.js
//
// Free text from a check or an external report is DATA. It is clipped,
// stripped of control characters and scrubbed of credential-shaped strings
// before it can reach analysis.json, so the report never carries more of a
// source than a bounded field and never a secret.
import { SECRET_SHAPES } from '../score/evidence.js';

export const REDACTED = '[redacted]';

/** Remove control characters (including newlines and tabs) and collapse whitespace. */
export function plain(value) {
  return Array.from(String(value), (ch) => {
    const c = ch.codePointAt(0);
    return c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029 ? ' ' : ch;
  }).join('').replace(/\s+/g, ' ').trim();
}

/** Replace every credential-shaped substring. Returns {text, redactions}. */
export function redact(text) {
  let out = text;
  let redactions = 0;
  for (const shape of SECRET_SHAPES) {
    const re = new RegExp(shape.source, shape.flags.includes('g') ? shape.flags : `${shape.flags}g`);
    out = out.replace(re, () => { redactions += 1; return REDACTED; });
  }
  return { text: out, redactions };
}

/** Clip to `max` characters, marking the cut. */
export function clip(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * The one door for untrusted text: plain, scrubbed, clipped. `sink.redactions`
 * is incremented so the analysis can say how many substrings were removed.
 */
export function safeText(value, max, sink) {
  if (value === undefined || value === null) return '';
  let raw = plain(value);
  // The checkout's absolute path would make the output differ between machines: never print it.
  if (sink?.root && sink.root.length > 1) raw = raw.split(sink.root).join('<root>');
  const { text, redactions } = redact(raw);
  if (sink) sink.redactions = (sink.redactions ?? 0) + redactions;
  return clip(text, max);
}

/** A path-like or URL string with any query or fragment removed (they can carry tokens). */
export function safeLocationString(value, max, sink) {
  const s = plain(value).replace(/[?#].*$/, '').replace(/^[a-z][a-z0-9+.-]*:\/\/[^/@\s]*@/i, (m) => m.replace(/\/\/[^/@]*@/, '//'));
  return safeText(s, max, sink);
}

export const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
