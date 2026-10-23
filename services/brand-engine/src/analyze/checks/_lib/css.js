// services/brand-engine/src/analyze/checks/_lib/css.js
//
// A forgiving CSS reader: comments, nesting (CSS nesting and SCSS), at-rules, custom
// properties and `var()` resolution, and the light/dark theme layering the contrast and
// token checks need. It is not a CSS engine: no cascade, no specificity, no @import
// following, no computed styles. Anything it cannot read it leaves out, and callers
// count what was left out rather than guess.
import { parseColor } from './color.js';

/** Strip comments, keeping line breaks. `//` comments only for scss/less (they break url(//...)). */
export function stripComments(css, { lineComments = false } = {}) {
  let out = '';
  const n = css.length;
  let i = 0;
  while (i < n) {
    const c = css[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && css[j] !== c && css[j] !== '\n') j += css[j] === '\\' ? 2 : 1;
      out += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += css.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    if (lineComments && c === '/' && css[i + 1] === '/' && css[i - 1] !== ':') {
      let j = i;
      while (j < n && css[j] !== '\n') j += 1;
      out += ' '.repeat(j - i);
      i = j;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * Parse CSS into flat rules.
 * @returns {{ rules: Array<{selector:string, at:string[], decls:Array<{prop:string,value:string,line:number}>, line:number, keyframes:boolean, fontFace:boolean}>, vars: Array }}
 */
export function parseCss(source, { scss = false, lineOffset = 0 } = {}) {
  const css = stripComments(source, { lineComments: scss });
  const rules = [];
  const n = css.length;
  const frames = []; // block stack: { selector, at, rule }
  let rootVars = null;
  let i = 0;
  let line = 1 + lineOffset;
  let start = 0;
  let startLine = line;

  const current = () => frames[frames.length - 1];
  const atStack = () => frames.filter((f) => f.kind === 'at').map((f) => f.prelude);

  const resolveSelector = (prelude) => {
    const parent = [...frames].reverse().find((f) => f.kind === 'rule');
    if (!parent) return prelude.trim();
    const kids = splitTop(prelude, ',');
    const parents = splitTop(parent.selector, ',');
    const out = [];
    for (const p of parents) {
      for (const k of kids) out.push(k.includes('&') ? k.replaceAll('&', p.trim()) : `${p.trim()} ${k.trim()}`);
    }
    return out.join(', ');
  };

  const pushDecl = (text, atLine) => {
    const f = current();
    if (!f || f.kind === 'at-only') return;
    const m = /^\s*([$@]?[-\w]+)\s*:\s*([\s\S]*?)\s*$/.exec(text);
    if (!m) return;
    const rule = [...frames].reverse().find((fr) => fr.kind === 'rule');
    if (!rule) return;
    rule.rule.decls.push({ prop: m[1].toLowerCase().startsWith('--') ? m[1] : m[1].toLowerCase(), value: m[2].replace(/\s*!important$/i, '').trim(), line: atLine });
  };

  while (i < n) {
    const c = css[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && css[j] !== c && css[j] !== '\n') j += css[j] === '\\' ? 2 : 1;
      i = j + 1;
      continue;
    }
    if (c === '(') {
      // keep url(...) and function bodies intact (they may contain ; or {})
      let depth = 0;
      let j = i;
      while (j < n) {
        if (css[j] === '(') depth += 1;
        else if (css[j] === ')') { depth -= 1; if (depth === 0) break; }
        else if (css[j] === '\n') line += 1;
        else if (css[j] === '"' || css[j] === "'") { const q = css[j]; j += 1; while (j < n && css[j] !== q) j += css[j] === '\\' ? 2 : 1; }
        j += 1;
      }
      i = j + 1;
      continue;
    }
    if (c === '\n') { line += 1; i += 1; continue; }
    if (c === '{') {
      const rawPrelude = css.slice(start, i);
      const prelude = rawPrelude.trim();
      startLine += rawPrelude.slice(0, rawPrelude.length - rawPrelude.trimStart().length).match(/\n/g)?.length ?? 0;
      if (prelude.startsWith('@')) {
        const name = /^@([-\w]+)/.exec(prelude)?.[1]?.toLowerCase() ?? '';
        if (name === 'keyframes' || name.endsWith('-keyframes')) {
          const rule = { selector: prelude, at: atStack(), decls: [], line: startLine, keyframes: true, fontFace: false };
          rules.push(rule);
          frames.push({ kind: 'keyframes', prelude, rule });
        } else if (name === 'font-face') {
          const rule = { selector: '@font-face', at: atStack(), decls: [], line: startLine, keyframes: false, fontFace: true };
          rules.push(rule);
          frames.push({ kind: 'rule', selector: '@font-face', rule });
        } else if (name === 'theme' || name === 'property' || name === 'page' || name === 'view-transition') {
          const rule = { selector: name === 'theme' ? ':root' : prelude, at: atStack(), decls: [], line: startLine, keyframes: false, fontFace: false, theme: name === 'theme' };
          rules.push(rule);
          frames.push({ kind: 'rule', selector: rule.selector, rule });
        } else {
          frames.push({ kind: 'at', prelude });
        }
      } else if (frames.some((f) => f.kind === 'keyframes')) {
        frames.push({ kind: 'frame', prelude });
      } else if (/^[$@][-\w]+\s*:/.test(prelude) || /^[-\w]+\s*:\s*$/.test(prelude) || prelude === '') {
        frames.push({ kind: 'skip', prelude });
      } else {
        const selector = resolveSelector(prelude);
        const rule = { selector, at: atStack(), decls: [], line: startLine, keyframes: false, fontFace: false };
        rules.push(rule);
        frames.push({ kind: 'rule', selector, rule });
      }
      i += 1;
      start = i;
      startLine = line;
      continue;
    }
    if (c === ';' || c === '}') {
      const text = css.slice(start, i);
      const lead = text.length - text.trimStart().length;
      const declLine = startLine + (text.slice(0, lead).match(/\n/g)?.length ?? 0);
      const f = current();
      if (text.trim() !== '' && f && (f.kind === 'rule')) pushDecl(text, declLine);
      else if (text.trim() !== '' && !f && /^\s*\$[-\w]+\s*:/.test(text)) {
        if (!rootVars) { rootVars = { selector: ':root', at: [], decls: [], line: declLine, keyframes: false, fontFace: false }; rules.push(rootVars); }
        const m = /^\s*(\$[-\w]+)\s*:\s*([\s\S]*?)\s*$/.exec(text);
        if (m) rootVars.decls.push({ prop: m[1], value: m[2].replace(/\s*!default$/i, ''), line: declLine });
      }
      if (c === '}') frames.pop();
      i += 1;
      start = i;
      startLine = line;
      continue;
    }
    i += 1;
  }
  return { rules };
}

function splitTop(text, sep) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim() !== '') out.push(cur);
  return out;
}
export { splitTop };

// ---- themes --------------------------------------------------------------------------------------

const DARK_MARK = /\.(?:dark|theme-dark|dark-mode|is-dark)(?![\w-])|\[data-[\w-]*(?:theme|mode|scheme)[\w-]*\s*[~|^$*]?=\s*["']?dark["']?\s*\]/i;
const LIGHT_MARK = /\.(?:light|theme-light|light-mode|is-light)(?![\w-])|\[data-[\w-]*(?:theme|mode|scheme)[\w-]*\s*[~|^$*]?=\s*["']?light["']?\s*\]/i;
const ROOTISH = /^(?::root|html|body|\*|:host|page|\[data-[\w-]*(?:theme|mode|scheme)[\w-]*\])$/i;

const stripNot = (sel) => {
  let out = sel;
  for (let guard = 0; guard < 5 && /:not\(/.test(out); guard += 1) out = out.replace(/:not\([^()]*(?:\([^()]*\)[^()]*)*\)/g, '');
  return out;
};

/**
 * Classify one selector of a rule into the theme it defines or is scoped to.
 * Returns 'dark' | 'light' | 'base' | 'scoped' | 'skip'. 'base' means "applies to every theme".
 */
export function classifySelector(selector, at) {
  const media = at.join(' ').toLowerCase();
  if (/prefers-contrast|forced-colors|\bprint\b|prefers-reduced|inverted-colors/.test(media)) return 'skip';
  const bare = stripNot(selector).trim();
  const inDarkMedia = /prefers-color-scheme\s*:\s*dark/.test(media);
  const inLightMedia = /prefers-color-scheme\s*:\s*light/.test(media);
  if (DARK_MARK.test(bare) || inDarkMedia) return 'dark';
  if (LIGHT_MARK.test(bare) || inLightMedia) return 'light';
  // :root, html, body, *  (possibly with attribute/pseudo qualifiers other than a theme marker)
  const head = bare.replace(/:(?!root|host)[\w-]+(?:\([^)]*\))?/g, '').trim();
  if (ROOTISH.test(bare) || head === '' || /^(?:html|body|\*|:root)$/.test(head)) return 'base';
  return 'scoped';
}

/**
 * Collect custom properties into theme layers.
 * @param {Array<{rules:Array}>} sheets parsed stylesheets in file order
 * @returns {{ light: Map<string,string>, dark: Map<string,string>, hasDark: boolean, hasLight: boolean, base: Map }}
 */
export function buildThemes(sheets) {
  const base = new Map();
  const light = new Map();
  const dark = new Map();
  const origins = new Map();
  for (const sheet of sheets) {
    for (const rule of sheet.rules) {
      if (rule.keyframes) continue;
      const parts = splitTop(rule.selector, ',');
      const classes = new Set(parts.map((p) => classifySelector(p, rule.at)));
      const decls = rule.decls.filter((d) => d.prop.startsWith('--') || d.prop.startsWith('$'));
      if (!decls.length) continue;
      for (const d of decls) {
        const value = d.value;
        if (!origins.has(d.prop) || classes.has('base')) origins.set(d.prop, { file: sheet.file, line: d.line });
        if (classes.has('base')) base.set(d.prop, value);
        if (classes.has('light')) light.set(d.prop, value);
        if (classes.has('dark')) dark.set(d.prop, value);
      }
    }
  }
  return {
    base,
    light: new Map([...base, ...light]),
    dark: new Map([...base, ...dark]),
    hasDark: dark.size > 0,
    hasLight: light.size > 0,
    origins,
  };
}

/** Resolve var() chains inside a value. Returns the substituted string or null if any var is undefined. */
export function resolveVars(value, tokens, local = null, depth = 0) {
  if (depth > 12 || typeof value !== 'string') return null;
  let out = '';
  let i = 0;
  while (i < value.length) {
    const at = value.indexOf('var(', i);
    if (at === -1) { out += value.slice(i); break; }
    if (at > 0 && /[\w-]/.test(value[at - 1])) { out += value.slice(i, at + 4); i = at + 4; continue; }
    out += value.slice(i, at);
    let j = at + 4;
    let paren = 1;
    while (j < value.length && paren > 0) { if (value[j] === '(') paren += 1; else if (value[j] === ')') paren -= 1; j += 1; }
    const inner = value.slice(at + 4, j - 1);
    const comma = inner.indexOf(',');
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma === -1 ? null : inner.slice(comma + 1).trim();
    let raw = local?.get(name) ?? tokens.get(name);
    if (raw === undefined) raw = fallback ?? undefined;
    if (raw === undefined) return null;
    const sub = resolveVars(raw, tokens, local, depth + 1);
    if (sub === null) return null;
    out += sub;
    i = j;
  }
  return out;
}

/** Resolve a value to a colour in a theme (var chains, alpha), or null. */
export function colorOf(value, tokens, local = null) {
  const resolved = resolveVars(value, tokens, local);
  if (resolved === null) return null;
  return parseColor(resolved);
}

/** The name a pair reports for a value: `--token` for a var(), otherwise the literal text. */
export function nameOf(value) {
  const m = /^var\(\s*(--[\w-]+)/.exec(value.trim());
  return m ? m[1] : value.trim();
}

/** First colour-like expression in a (shorthand) value: var(), hex, rgb/hsl/oklch, or null. */
export function firstColorExpr(value) {
  if (/gradient\(|url\(/i.test(value)) return null;
  const v = value.trim();
  const m = /^(var\((?:[^()]|\([^()]*\))*\)|#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|oklch|oklab)\([^()]*\)|[a-z]+)/i.exec(v);
  if (!m) return null;
  if (/^(?:none|inherit|initial|unset|revert|currentcolor|transparent)$/i.test(m[1])) return null;
  return m[1];
}
