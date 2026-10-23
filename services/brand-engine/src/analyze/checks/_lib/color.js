// services/brand-engine/src/analyze/checks/_lib/color.js
//
// CSS colour parsing and the WCAG 2.x relative luminance / contrast maths.
// Pure functions, no I/O. Anything that cannot be parsed returns null, and the
// caller treats a null as "undetermined" (never as a pass).
//
// Contrast follows WCAG 2.2 (success criterion 1.4.3 definition of relative
// luminance and contrast ratio). The linearisation threshold is 0.04045, the
// value in the IEC sRGB standard that the W3C corrected 0.03928 to; the two
// differ only for 8-bit channel values 10 and 11 and never change a result
// at the 3:1 or 4.5:1 boundaries for any pair in the unit tests.

const NAMED = {
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], lime: [0, 255, 0], blue: [0, 0, 255],
  yellow: [255, 255, 0], cyan: [0, 255, 255], aqua: [0, 255, 255], magenta: [255, 0, 255], fuchsia: [255, 0, 255],
  silver: [192, 192, 192], gray: [128, 128, 128], grey: [128, 128, 128], maroon: [128, 0, 0], olive: [128, 128, 0],
  green: [0, 128, 0], purple: [128, 0, 128], teal: [0, 128, 128], navy: [0, 0, 128], orange: [255, 165, 0],
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round8 = (n) => Math.round(clamp(n, 0, 255));

function parseNumberOrPercent(token, scale) {
  const t = token.trim();
  if (t === 'none') return 0;
  if (t.endsWith('%')) return (parseFloat(t) / 100) * scale;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : NaN;
}

function parseAlpha(token) {
  if (token === undefined) return 1;
  const a = parseNumberOrPercent(token, 1);
  return Number.isFinite(a) ? clamp(a, 0, 1) : NaN;
}

function parseHue(token) {
  const t = token.trim();
  let n = parseFloat(t);
  if (!Number.isFinite(n)) return NaN;
  if (t.endsWith('turn')) n *= 360;
  else if (t.endsWith('rad')) n = (n * 180) / Math.PI;
  else if (t.endsWith('grad')) n *= 0.9;
  return ((n % 360) + 360) % 360;
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgb.map((v) => (v + m) * 255);
}

const toSrgbChannel = (lin) => {
  const v = clamp(lin, 0, 1);
  return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
};

function oklabToRgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    toSrgbChannel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgbChannel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgbChannel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function splitArgs(inner) {
  // "r g b / a", "r, g, b, a" or "r g b"
  let alpha;
  let body = inner.trim();
  const slash = body.indexOf('/');
  if (slash >= 0) { alpha = body.slice(slash + 1).trim(); body = body.slice(0, slash).trim(); }
  const parts = body.includes(',') ? body.split(',').map((p) => p.trim()) : body.split(/\s+/);
  if (alpha === undefined && parts.length === 4) alpha = parts.pop();
  return { parts, alpha };
}

/**
 * Parse a CSS colour. Returns {r,g,b,a} (r,g,b in 0..255 integers, a in 0..1) or
 * null when the value is not a colour this module understands (var(), currentColor,
 * color-mix(), lab(), a gradient, anything dynamic).
 */
export function parseColor(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase().replace(/\s*!important$/, '');
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (NAMED[s]) return { r: NAMED[s][0], g: NAMED[s][1], b: NAMED[s][2], a: 1 };

  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }

  m = /^(rgba?|hsla?|oklch|oklab)\(([^()]*)\)$/.exec(s);
  if (!m) return null;
  const fn = m[1];
  const { parts, alpha } = splitArgs(m[2]);
  const a = parseAlpha(alpha);
  if (Number.isNaN(a) || parts.length !== 3) return null;

  if (fn === 'rgb' || fn === 'rgba') {
    const ch = parts.map((p) => parseNumberOrPercent(p, 255));
    if (ch.some(Number.isNaN)) return null;
    return { r: round8(ch[0]), g: round8(ch[1]), b: round8(ch[2]), a };
  }
  if (fn === 'hsl' || fn === 'hsla') {
    const h = parseHue(parts[0]);
    const sat = parseNumberOrPercent(parts[1], 1);
    const lig = parseNumberOrPercent(parts[2], 1);
    if ([h, sat, lig].some(Number.isNaN)) return null;
    const [r, g, b] = hslToRgb(h, clamp(sat, 0, 1), clamp(lig, 0, 1));
    return { r: round8(r), g: round8(g), b: round8(b), a };
  }
  if (fn === 'oklch') {
    const L = parseNumberOrPercent(parts[0], 1);
    const C = parseNumberOrPercent(parts[1], 0.4);
    const H = parseHue(parts[2]);
    if ([L, C, H].some(Number.isNaN)) return null;
    const rad = (H * Math.PI) / 180;
    const [r, g, b] = oklabToRgb(L, C * Math.cos(rad), C * Math.sin(rad));
    return { r: round8(r), g: round8(g), b: round8(b), a };
  }
  // oklab
  const L = parseNumberOrPercent(parts[0], 1);
  const A = parseNumberOrPercent(parts[1], 0.4);
  const B = parseNumberOrPercent(parts[2], 0.4);
  if ([L, A, B].some(Number.isNaN)) return null;
  const [r, g, b] = oklabToRgb(L, A, B);
  return { r: round8(r), g: round8(g), b: round8(b), a };
}

/** Composite a translucent colour over an opaque backdrop (browser behaviour: in sRGB space). */
export function compositeOver(fg, bg) {
  const a = fg.a;
  return {
    r: round8(fg.r * a + bg.r * (1 - a)),
    g: round8(fg.g * a + bg.g * (1 - a)),
    b: round8(fg.b * a + bg.b * (1 - a)),
    a: 1,
  };
}

const lin = (c8) => {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of an opaque colour. */
export function relativeLuminance({ r, g, b }) {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two opaque colours, 1..21, unrounded. */
export function contrastRatio(c1, c2) {
  const l1 = relativeLuminance(c1);
  const l2 = relativeLuminance(c2);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG thresholds are compared on the unrounded ratio: 4.499 does not meet 4.5. */
export const meetsContrast = (ratio, threshold) => ratio >= threshold;

export const toHex = ({ r, g, b }) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** Regex source for a colour literal inside a CSS value (hex, rgb[a], hsl[a], oklch, oklab). */
export const COLOR_LITERAL_SOURCE = '#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\\b|\\b(?:rgba?|hsla?|oklch|oklab)\\([^()]*\\)';
