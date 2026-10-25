// services/brand-engine/src/analyze/checks/_lib/tokens.js
//
// What the stylesheets and templates say about colours, fonts, spacing and type size, collected once
// per run for the token-consistency checks (d2, d4 scale, d9). Counts are of VALUES in declarations, not
// of rendered pixels. A value in a custom-property definition (`--ink: #111`) is a token definition,
// not a hard-coded literal.
import { COLOR_LITERAL_SOURCE, parseColor, toHex } from './color.js';
import { splitTop } from './css.js';
import { lengthPx } from './units.js';
import { designDoc, stylesheets, templates } from './sources.js';

export const COLOR_PROPS = /^(?:color|background|background-color|background-image|border|border-(?:top|right|bottom|left)|border-(?:top|right|bottom|left)?-?color|outline|outline-color|fill|stroke|box-shadow|text-shadow|caret-color|accent-color|text-decoration|text-decoration-color|column-rule|column-rule-color|stop-color|flood-color|-webkit-text-fill-color)$/;
const SPACING_PROPS = /^(?:margin|padding|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?$/;
const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', 'inherit', 'initial', 'unset', 'revert', '-apple-system', 'blinkmacsystemfont']);
export const TW_PALETTE = new Set(['slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose', 'white', 'black']);
const TW_COLOR_UTIL = /^(?:bg|text|border(?:-[trblxy])?|ring|ring-offset|fill|stroke|from|via|to|outline|decoration|divide|accent|caret|shadow|placeholder)-([a-z][\w-]*?)(?:-(\d{2,3}))?(?:\/[\w.[\]%]+)?$/;

const LITERAL_RE = () => new RegExp(COLOR_LITERAL_SOURCE, 'gi');

/** Distinct, normalised hex of a colour literal string, or null when it cannot be read. */
export function hexOf(literal) {
  const c = parseColor(literal);
  return c && c.a === 1 ? toHex(c) : c ? `${toHex(c)}@${c.a.toFixed(2)}` : null;
}

function twConfigColors(repo) {
  const names = new Set();
  for (const rel of ['tailwind.config.js', 'tailwind.config.cjs', 'tailwind.config.mjs', 'tailwind.config.ts']) {
    const src = repo.read(rel);
    if (src === null) continue;
    const at = src.search(/\bcolors\s*:\s*\{/);
    if (at === -1) continue;
    const open = src.indexOf('{', at);
    let depth = 0;
    let i = open;
    for (; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') { depth -= 1; if (depth === 0) break; }
    }
    const body = src.slice(open + 1, i);
    for (const m of body.matchAll(/(?:^|[,{\s])(['"]?)([a-zA-Z][\w-]*)\1\s*:/g)) names.add(m[2].toLowerCase());
  }
  return names;
}

export function tokenFacts(repo) {
  return repo.memo('tokenFacts', () => {
    const sheets = stylesheets(repo);
    const declared = new Set();
    const declaredValues = new Map(); // name -> raw value (last)
    for (const s of sheets) for (const r of s.rules) for (const d of r.decls) {
      if (d.prop.startsWith('--') || d.prop.startsWith('$')) { declared.add(d.prop); declaredValues.set(d.prop, d.value); }
    }
    const themeColorNames = new Set([...twConfigColors(repo)]);
    for (const n of declared) { const m = /^--color-([\w-]+)$/.exec(n); if (m) themeColorNames.add(m[1].toLowerCase()); }
    // nested names: brand-500 -> brand
    for (const n of [...themeColorNames]) { const m = /^(.*)-\d{2,3}$/.exec(n); if (m) themeColorNames.add(m[1]); }

    const colour = { token: 0, literal: 0, framework: 0, literalsByFile: new Map(), tokenByFile: new Map(), values: new Map() };
    const undefinedTokens = new Map();
    const fonts = []; // {family, file, line, source}
    const spacing = []; // {file, line, kind:'spacing'|'font-size', px:number|null, token:boolean, raw}

    const noteColourValue = (value, file, line) => {
      let m;
      const re = LITERAL_RE();
      while ((m = re.exec(value)) !== null) {
        colour.literal += 1;
        const hex = hexOf(m[0]);
        const arr = colour.literalsByFile.get(file) ?? [];
        arr.push({ line, text: m[0], hex });
        colour.literalsByFile.set(file, arr);
        if (hex && !colour.values.has(hex)) colour.values.set(hex, { file, line });
      }
      const vr = /var\(\s*(--[\w-]+)/g;
      while ((m = vr.exec(value)) !== null) {
        const name = m[1];
        if (name.startsWith('--tw-')) continue;
        if (declared.has(name)) {
          colour.token += 1;
          colour.tokenByFile.set(file, (colour.tokenByFile.get(file) ?? 0) + 1);
        } else if (!undefinedTokens.has(name)) undefinedTokens.set(name, { file, line });
      }
    };

    const noteSpacing = (prop, value, file, line) => {
      const kind = prop === 'font-size' ? 'font-size' : 'spacing';
      if (/^(?:inherit|initial|unset|revert|auto|0)$/i.test(value.trim())) return;
      for (const piece of splitTop(value.replace(/\s+/g, ' ').replace(/\s*!important/i, ''), ' ')) {
        const tok = piece.trim();
        if (!tok) continue;
        if (tok.includes('var(') || /^(?:calc|clamp|min|max)\(/.test(tok)) { spacing.push({ file, line, kind, px: null, token: tok.includes('var('), raw: tok }); continue; }
        const px = lengthPx(tok);
        if (px === null || px === 0) continue;
        spacing.push({ file, line, kind, px, token: false, raw: tok });
      }
    };

    const noteFont = (value, file, line, source) => {
      let resolved = value;
      for (let guard = 0; guard < 6 && /^var\(/.test(resolved.trim()); guard += 1) {
        const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.*))?\)\s*$/.exec(resolved.trim());
        if (!m) break;
        resolved = declaredValues.get(m[1]) ?? m[2] ?? '';
      }
      if (!resolved || resolved.includes('var(')) return;
      const first = splitTop(resolved, ',')[0]?.trim().replace(/^["']|["']$/g, '');
      if (!first || GENERIC_FAMILIES.has(first.toLowerCase())) { if (first) fonts.push({ family: first.toLowerCase(), generic: true, file, line, source }); return; }
      fonts.push({ family: first, generic: false, file, line, source });
    };

    for (const s of sheets) {
      for (const r of s.rules) {
        if (r.fontFace) {
          const ff = r.decls.find((d) => d.prop === 'font-family');
          if (ff) fonts.push({ family: ff.value.replace(/^["']|["']$/g, ''), generic: false, file: s.file, line: ff.line, source: '@font-face', declaredOnly: true });
          continue;
        }
        for (const d of r.decls) {
          if (d.prop.startsWith('--') || d.prop.startsWith('$')) {
            continue; // definitions are not usages; font stacks are resolved where used
          }
          if (COLOR_PROPS.test(d.prop)) noteColourValue(d.value, s.file, d.line);
          if (d.prop === 'font-family') noteFont(d.value, s.file, d.line, 'font-family');
          if (d.prop === 'font') { const fam = /(?:\d[\w%.]*(?:\/[\w.%]+)?)\s+(.+)$/.exec(d.value); if (fam) noteFont(fam[1], s.file, d.line, 'font'); }
          if (SPACING_PROPS.test(d.prop)) noteSpacing(d.prop, d.value, s.file, d.line);
          if (d.prop === 'font-size') noteSpacing('font-size', d.value, s.file, d.line);
        }
      }
    }

    for (const t of templates(repo)) {
      for (const link of t.source.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'\s)>]+)/g)) {
        for (const fm of link[1].matchAll(/family=([^&:;"']+)/g)) {
          const family = decodeURIComponent(fm[1].replace(/\+/g, ' '));
          fonts.push({ family, generic: false, file: t.rel, line: t.source.slice(0, link.index).split('\n').length, source: 'google-fonts' });
        }
      }
      for (const el of t.elements) {
        if (el.component) continue;
        const style = el.attrs.get('style');
        if (style && !style.dynamic) {
          for (const decl of style.value.split(';')) {
            const m = /^\s*([-\w]+)\s*:\s*(.+?)\s*$/.exec(decl);
            if (!m) continue;
            const prop = m[1].toLowerCase();
            if (COLOR_PROPS.test(prop)) noteColourValue(m[2], t.rel, style.line);
            if (prop === 'font-family') noteFont(m[2], t.rel, style.line, 'inline-style');
            if (SPACING_PROPS.test(prop) || prop === 'font-size') noteSpacing(prop, m[2], t.rel, style.line);
          }
        }
        for (const a of ['fill', 'stroke', 'stop-color', 'flood-color']) {
          const v = el.attrs.get(a);
          if (v && !v.dynamic && /^#|^rgb|^hsl/i.test(v.value.trim())) noteColourValue(v.value, t.rel, v.line);
        }
        const cls = el.attrs.get('class');
        if (cls) {
          for (const tok of cls.value.split(/\s+/).filter(Boolean)) {
            const bare = tok.replace(/^(?:[\w-]+:)+/, '');
            if (/\[(?:#|rgba?\(|hsla?\(|oklch\()/.test(bare) && /^[a-z-]+-\[/.test(bare)) { noteColourValue(bare.slice(bare.indexOf('[') + 1, bare.lastIndexOf(']')).replaceAll('_', ' '), t.rel, cls.line); continue; }
            if (/^[a-z-]+-(?:\[var\(--|\(--)/.test(bare)) { colour.token += 1; colour.tokenByFile.set(t.rel, (colour.tokenByFile.get(t.rel) ?? 0) + 1); continue; }
            const m = TW_COLOR_UTIL.exec(bare);
            if (!m) continue;
            const name = m[1].toLowerCase();
            const full = m[2] ? `${name}-${m[2]}` : name;
            if (themeColorNames.has(full) || themeColorNames.has(name)) { colour.token += 1; colour.tokenByFile.set(t.rel, (colour.tokenByFile.get(t.rel) ?? 0) + 1); }
            else if (TW_PALETTE.has(name)) colour.framework += 1;
          }
        }
      }
    }

    // declared scales
    const design = designDoc(repo);
    const spacingScale = new Set();
    const typeScale = new Set();
    const addScale = (set, raw) => { const px = lengthPx(String(raw)); if (px !== null && px > 0) set.add(Math.round(px * 100) / 100); };
    for (const [name, raw] of declaredValues) {
      const bare = name.replace(/^--/, '');
      if (/(?:^|-)(?:space|spacing|gap|gutter)(?:-|$)/.test(bare)) addScale(spacingScale, raw);
      else if (/(?:^|-)(?:text|font-size|fs|type|step)(?:-|$)/.test(bare) && !/color|line|height|weight|family|shadow/.test(bare)) addScale(typeScale, raw);
    }
    for (const v of Object.values(design?.front?.spacing ?? {})) addScale(spacingScale, v);
    for (const t of Object.values(design?.front?.typography ?? {})) if (t && typeof t === 'object') addScale(typeScale, t.fontSize);

    return { declared, declaredValues, themeColorNames, colour, undefinedTokens, fonts, spacing, spacingScale, typeScale };
  });
}
