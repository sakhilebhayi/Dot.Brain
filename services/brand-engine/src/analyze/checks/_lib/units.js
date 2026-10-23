// services/brand-engine/src/analyze/checks/_lib/units.js
// CSS lengths to pixels (16px root, em treated as rem). Returns null for anything else.
export function lengthPx(value) {
  if (typeof value !== 'string') return null;
  const m = /^\s*(-?\d*\.?\d+)(px|rem|em|pt)?\s*$/.exec(value);
  if (!m) return null;
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case 'px': return n;
    case 'rem': case 'em': return n * 16;
    case 'pt': return (n * 4) / 3;
    case undefined: return n === 0 ? 0 : null;
    default: return null;
  }
}
