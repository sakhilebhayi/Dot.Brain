// d8.token_pair_contrast: WCAG 2.2 contrast of foreground/background colour PAIRS declared in the
// stylesheets (and in a DESIGN.md front matter), on both themes.
//
// Which pairs: only pairs the code itself declares or names.
//   usage     a rule that sets both `color` and `background(-color)`          (blocker if it fails)
//   design-md a DESIGN.md `components` entry with backgroundColor + textColor (blocker if it fails)
//   naming    X and X-ink / X-foreground / X-fg / on-X                         (major if it fails)
//   ground    a plain text token (--text, --muted, ...) on a ground/panel token (--bg, --panel, ...) (major)
//   focus     a focus-indicator token (--focus, --ring) or the colour of an outline in a :focus rule, against the
//             ground/panel tokens, at 3:1 (WCAG 1.4.11 non-text contrast) (major)
// Pairs it cannot resolve to two opaque colours are counted as undetermined and never as passes. With no
// determinable pair the check is not_measured.
import { defineCheck } from './_lib/define.js';
import { designDoc, stylesheets, hasUi } from './_lib/sources.js';
import { buildThemes, classifySelector, colorOf, firstColorExpr, nameOf, splitTop } from './_lib/css.js';
import { compositeOver, contrastRatio, toHex } from './_lib/color.js';
import { lengthPx } from './_lib/units.js';

const ID = 'd8.token_pair_contrast';
const label = (expr, c) => (nameOf(expr) === toHex(c) ? toHex(c) : `${nameOf(expr)} (${toHex(c)})`);
const NORMAL = 4.5;
const LARGE = 3.0;

const GROUND_WORDS = new Set(['bg', 'background', 'ground', 'canvas', 'surface', 'panel', 'page', 'card', 'elevated', 'sunken', 'raised']);
const NOT_GROUND = /(?:^|-)(?:text|ink|fg|foreground|border|rule|line|shadow|overlay|wash|hover|focus|ring|accent|on|muted-fg|disabled)(?:-|$)/;
const PLAIN_TEXT = /^--(?:[a-z0-9]+-)?(?:text|fg|foreground|ink|body|muted|subtle|secondary|tertiary|dim|content)(?:-(?:\d+|primary|secondary|tertiary|muted|subtle|strong|soft|default|base))?$/;
const PARTNER_SUFFIX = /^(--.+?)-(?:ink|foreground|fg|contrast)(?:-\d+)?$/;
const PARTNER_ON = /^(--(?:[a-z0-9]+-)*?)on-(.+)$/;
const FOCUS_TOKEN = /^--(?!default-|tw-)(?:[a-z0-9]+-)?(?:focus|focus-ring|ring|outline)(?:-colou?r)?$/;
const SKIP_STATE = /:disabled|\[disabled\]|\.disabled|\[aria-disabled|::selection/i;

// A word that makes a token belong to one component or state rather than to the page: --input-bg, --sidebar-bg.
const COMPONENT_WORDS = new Set(['input', 'sidebar', 'topbar', 'header', 'footer', 'nav', 'track', 'btn', 'button', 'chip', 'badge', 'tag', 'tooltip', 'toast', 'modal', 'dialog', 'menu', 'dropdown', 'field', 'tab', 'row', 'cell', 'code', 'kbd', 'overlay', 'selected', 'ghost', 'danger', 'warn', 'ok', 'info', 'success', 'error', 'accent', 'brand', 'primary', 'secondary', 'default', 'tw']);
const isGroundName = (name) => {
  const segs = name.slice(2).split('-');
  if (NOT_GROUND.test(name.slice(2)) || segs.some((seg) => COMPONENT_WORDS.has(seg))) return false;
  return segs.some((seg) => GROUND_WORDS.has(seg));
};

function isLarge(rule, tokens) {
  const size = rule.decls.find((d) => d.prop === 'font-size');
  const weight = rule.decls.find((d) => d.prop === 'font-weight');
  if (!size) return false;
  const resolved = size.value.includes('var(') ? null : size.value;
  const px = resolved ? lengthPx(resolved) : null;
  if (px === null) return false;
  const w = weight ? weight.value.trim().toLowerCase() : '';
  const bold = w === 'bold' || w === 'bolder' || Number(w) >= 700;
  return px >= 24 || (px >= 18.66 && bold);
}

function pairsFromTokens(tokens, names, themeNames, source, where, usedAsText = () => true) {
  const pairs = [];
  // Tokens that are used together are declared together: a token in one stylesheet is not paired with the
  // background of another stylesheet that has its own, unrelated palette.
  const together = (a, b) => (where(a)?.file ?? null) === (where(b)?.file ?? null);
  const partnered = new Set();
  for (const name of names) {
    let base = null;
    const a = PARTNER_SUFFIX.exec(name);
    if (a) base = a[1];
    else {
      const b = PARTNER_ON.exec(name);
      if (b) base = `${b[1]}${b[2]}`;
    }
    if (base && tokens.has(base) && together(name, base)) {
      partnered.add(name);
      pairs.push({ fg: `var(${name})`, bg: `var(${base})`, source: 'naming', themes: themeNames, where: where(name), selector: null, large: false, role: 'text' });
    }
  }
  const grounds = names.filter(isGroundName);
  for (const f of names.filter((n) => FOCUS_TOKEN.test(n))) {
    for (const g of grounds.filter((x) => together(f, x))) pairs.push({ fg: `var(${f})`, bg: `var(${g})`, source: 'focus', themes: themeNames, where: where(f), selector: null, large: false, role: 'ui' });
  }
  const texts = names.filter((n) => PLAIN_TEXT.test(n) && !partnered.has(n) && usedAsText(n));
  for (const t of texts) {
    for (const g of grounds.filter((x) => together(t, x))) {
      pairs.push({ fg: `var(${t})`, bg: `var(${g})`, source: 'ground', themes: themeNames, where: where(t), selector: null, large: false, role: 'text' });
    }
  }
  return pairs.map((p) => ({ ...p, from: source }));
}

export default defineCheck({
  id: ID,
  title: 'Token pair contrast (WCAG 2.2) on both themes',
  applies: (repo) => hasUi(repo),
  measure(repo) {
    const sheets = stylesheets(repo);
    // Every stylesheet is its own palette: a token a file declares wins over the same name declared elsewhere (a page that
    // carries its own <style>, or a second CSS file with --bg and --text of its own, must not borrow another palette's
    // dark theme). Tokens a file only USES (a components file reading tokens.css) resolve through the other files.
    const fileSheets = sheets.filter((s) => !s.inline);
    const scopes = sheets.map((s) => ({ all: [...fileSheets.filter((x) => x !== s), s], own: [s] }));
    const pairs = [];
    let anyDark = false;

    for (const scope of scopes) {
      if (scope.own.length === 0) continue;
      const themes = buildThemes(scope.all);
      const own = buildThemes(scope.own);
      for (const [k, v] of own.light) themes.light.set(k, v);
      for (const [k, v] of own.dark) themes.dark.set(k, v);
      for (const [k, v] of own.origins) themes.origins.set(k, v);
      const where = (name) => themes.origins.get(name) ?? null;
      const names = [...new Set([...own.light.keys(), ...own.dark.keys()])].filter((n) => n.startsWith('--'));
      // A file with a palette of its own switches to dark only if it says how; a file that just uses shared tokens follows them.
      const themeNames = own.hasDark || (names.length === 0 && themes.hasDark) ? ['light', 'dark'] : ['light'];
      anyDark = anyDark || themeNames.includes('dark');
      const merged = new Map([...themes.light, ...themes.dark]);
      // `ink` and `text` can name a surface as easily as a foreground: a plain text token is paired with the grounds only
      // when the stylesheet uses it as a text colour.
      const textUses = new Set();
      for (const sh of scope.own) for (const r of sh.rules) for (const d of r.decls) {
        if (d.prop === 'color' || d.prop === 'fill' || d.prop === 'caret-color') for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)/g)) textUses.add(m[1]);
      }
      pairs.push(...pairsFromTokens(merged, names, themeNames, 'css', where, (n) => textUses.has(n)).map((p) => ({ ...p, scope: themes })));

      for (const sheet of scope.own) {
        for (const rule of sheet.rules) {
          if (rule.keyframes || rule.fontFace) continue;
          if (/:focus/.test(rule.selector) && !/:not\(\s*:focus/.test(rule.selector)) {
            for (const d of rule.decls.filter((x) => x.prop === 'outline' || x.prop === 'outline-color')) {
              const expr = d.prop === 'outline-color' ? firstColorExpr(d.value) : /(var\((?:[^()]|\([^()]*\))*\)|#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|oklch)\([^()]*\))/i.exec(d.value)?.[1];
              if (!expr) continue;
              // the grounds declared beside the outline colour (or beside the rule, for a literal colour)
              const gs = names.filter(isGroundName);
              const m = /^var\(\s*(--[\w-]+)/.exec(expr);
              const home = m ? where(m[1])?.file : sheet.file;
              let pool = gs.filter((g) => where(g)?.file === home);
              if (!pool.length) pool = gs.filter((g) => where(g)?.file === sheet.file);
              if (!pool.length) pool = gs;
              for (const g of pool) pairs.push({ fg: expr, bg: `var(${g})`, source: 'focus', themes: themeNames, where: { file: sheet.file, line: d.line }, selector: rule.selector.replace(/\s+/g, ' ').slice(0, 60), large: false, role: 'ui', scope: themes });
            }
          }
          if (SKIP_STATE.test(rule.selector)) continue;
          const fgDecl = rule.decls.find((d) => d.prop === 'color');
          const bgDecl = rule.decls.find((d) => d.prop === 'background-color' || d.prop === 'background');
          if (!fgDecl || !bgDecl) continue;
          const fg = firstColorExpr(fgDecl.value);
          const bg = firstColorExpr(splitTop(bgDecl.value, ',').pop() ?? '');
          if (!fg || !bg) continue;
          if (nameOf(fg) === nameOf(bg)) continue; // one colour for both: a drawn shape (a dot, a bar), not text on a background
          const parts = splitTop(rule.selector, ',');
          const classes = new Set(parts.map((p) => classifySelector(p, rule.at)));
          if (classes.has('skip') && classes.size === 1) continue;
          let ts = themeNames;
          if (classes.has('dark') && !classes.has('light') && !classes.has('base') && !classes.has('scoped')) ts = ['dark'];
          else if (classes.has('light') && !classes.has('dark') && !classes.has('base') && !classes.has('scoped')) ts = ['light'];
          ts = ts.filter((t) => themeNames.includes(t));
          const local = new Map(rule.decls.filter((d) => d.prop.startsWith('--')).map((d) => [d.prop, d.value]));
          pairs.push({ fg, bg, source: 'usage', themes: ts, where: { file: sheet.file, line: bgDecl.line }, selector: rule.selector.slice(0, 60), large: isLarge(rule), role: 'text', local, scope: themes });
        }
      }
    }
    const themeNames = anyDark ? ['light', 'dark'] : ['light'];

    // DESIGN.md: token pairs and declared component pairs (light only; the front matter has no theme)
    const design = designDoc(repo);
    if (design?.front?.colors && typeof design.front.colors === 'object') {
      const dTokens = new Map();
      for (const [k, v] of Object.entries(design.front.colors)) if (typeof v === 'string') dTokens.set(`--${k}`, v);
      const at = (n) => ({ file: design.rel, line: 1, name: n });
      pairs.push(...pairsFromTokens(dTokens, [...dTokens.keys()], ['light'], 'design-md', () => at()).map((p) => ({ ...p, tokens: dTokens })));
      const ref = (v) => {
        const m = /^\{colors\.([\w-]+)\}$/.exec(String(v).trim());
        return m ? `var(--${m[1]})` : String(v);
      };
      for (const [cname, comp] of Object.entries(design.front.components ?? {})) {
        if (!comp || typeof comp !== 'object' || !comp.backgroundColor || !comp.textColor) continue;
        pairs.push({ fg: ref(comp.textColor), bg: ref(comp.backgroundColor), source: 'design-md', themes: ['light'], where: { file: design.rel, line: 1 }, selector: `components.${cname}`, large: false, role: 'text', tokens: dTokens });
      }
    }

    // Evaluate
    const scopeIds = new Map();
    for (const p of pairs) if (p.scope && !scopeIds.has(p.scope)) scopeIds.set(p.scope, scopeIds.size);
    const results = new Map();
    let undetermined = 0;
    // When the same pair is reached from several sources, the strongest evidence of use wins.
    const PRIORITY = { usage: 0, 'design-md': 1, naming: 2, ground: 3, focus: 4 };
    pairs.sort((a, b) => (PRIORITY[a.source] ?? 9) - (PRIORITY[b.source] ?? 9));
    for (const p of pairs) {
      for (const theme of p.themes) {
        const tokens = p.tokens ?? p.scope[theme];
        const fg0 = colorOf(p.fg, tokens, p.local);
        const bg = colorOf(p.bg, tokens, p.local);
        if (!fg0 || !bg) { undetermined += 1; continue; }
        // A translucent background takes its colour from whatever is behind it, which a stylesheet does not say.
        if (bg.a < 1) { undetermined += 1; continue; }
        const fg = fg0.a < 1 ? compositeOver(fg0, bg) : fg0;
        const threshold = p.role === 'ui' || p.large ? LARGE : NORMAL;
        const ratio = contrastRatio(fg, bg);
        const key = `${p.scope ? scopeIds.get(p.scope) : 'd'}|${theme}|${nameOf(p.fg)}|${nameOf(p.bg)}|${threshold}`;
        if (results.has(key)) continue;
        results.set(key, { theme, p, ratio, threshold, fg, bg, pass: ratio >= threshold });
      }
    }

    const all = [...results.values()];
    if (all.length === 0) {
      return {
        notMeasured: pairs.length === 0
          ? 'no foreground/background colour pairs are declared (no rule sets both color and background, no -ink/on- token pairs, no text and ground tokens)'
          : `${pairs.length} pair(s) were found but none resolved to two opaque colours (var() chains, color-mix() or gradients cannot be read statically)`,
      };
    }

    const findings = [];
    const floor2 = (n) => (Math.floor(n * 100) / 100).toFixed(2);
    for (const r of all) {
      if (r.pass) continue;
      const w = r.p.where ?? {};
      const blocker = r.p.source === 'usage' || (r.p.source === 'design-md' && r.p.selector);
      findings.push({
        rule: 'low-contrast',
        severity: blocker ? 'blocker' : 'major',
        kind: 'wcag_failure',
        level: 'AA',
        criterion: r.threshold === LARGE && r.p.role === 'ui' ? '1.4.11' : '1.4.3',
        message: `Contrast ${floor2(r.ratio)}:1 on the ${r.theme} theme is below ${r.threshold}:1 for ${label(r.p.fg, r.fg)} on ${label(r.p.bg, r.bg)}; source: ${r.p.source}${r.p.selector ? `, ${r.p.selector}` : ''}.`,
        file: w.file,
        line: w.line,
        hint: `Adjust one of the two tokens until the pair reaches ${r.threshold}:1 on the ${r.theme} theme, or stop using them together.`,
      });
    }

    const passed = all.filter((r) => r.pass).length;
    const bySource = {};
    for (const r of all) bySource[r.p.source] = (bySource[r.p.source] ?? 0) + 1;
    return {
      value: passed / all.length,
      detail: `${passed} of ${all.length} pair/theme combinations meet their threshold (4.5:1 text; 3:1 large text and focus indicators); themes evaluated: ${themeNames.join(', ')}; pair sources: ${Object.entries(bySource).sort().map(([k, v]) => `${k} ${v}`).join(', ')}; ${undetermined} combination(s) undetermined and not counted; translucent backgrounds are undetermined; panel backgrounds are tokens named bg/panel/surface/card/sunken.`,
      artifact: all.find((r) => r.p.where?.file)?.p.where.file,
      findings,
    };
  },
});
