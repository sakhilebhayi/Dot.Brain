// services/brand-engine/src/analyze/checks/_lib/markup.js
//
// A small, tolerant template reader for Blade, plain HTML, Vue/Svelte single-file
// components, JSX/TSX and Twig. It is NOT a conforming HTML parser. What it does:
//
//   * Dynamic fragments are opaque. `{{ ... }}`, `{!! ... !!}`, `@if(...)`, `<?php ?>`,
//     JSX `{...}` and the like are replaced, byte for byte in line count, with one of two
//     markers: DYN (\u0001, "a value is output here") or CTL (\u0002, "control flow, outputs
//     nothing by itself"). The expression text is kept in `exprs`, in order, so the
//     dead-link check can read `route('name')` without re-parsing the file.
//   * Line numbers are preserved: every removed region keeps its newlines.
//   * Components (`<x-button>`, `<Foo>`, `<livewire:bar>`, anything with a hyphen) are
//     opaque: checks must not guess what they render.
//   * Elements whose tag holds an opaque fragment outside an attribute value
//     (`<img {{ $attributes }}>`) are flagged `dynamicAttrs`; checks must not report a
//     missing attribute on them.
export const DYN = '\u0001';
export const CTL = '\u0002';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const AUTOCLOSE = new Set(['li', 'option', 'p', 'td', 'th', 'tr', 'dt', 'dd']);

const BLADE_CTL = 'if|elseif|else|endif|unless|endunless|isset|endisset|empty|endempty|foreach|endforeach|forelse|endforelse|for|endfor|while|endwhile|continue|break|switch|case|default|endswitch|auth|endauth|guest|endguest|can|endcan|cannot|endcannot|canany|endcanany|env|endenv|production|endproduction|section|endsection|show|stop|append|overwrite|extends|push|endpush|pushOnce|endPushOnce|prepend|endprepend|once|endonce|slot|endslot|component|endcomponent|props|aware|php|endphp|use|inject|error|enderror|session|endsession|hasSection|sectionMissing|class|style|checked|selected|disabled|required|readonly|dd|dump|csrf|method|livewireStyles|livewireScripts|verbatim|endverbatim|fragment|endfragment|pushIf|endPushIf|teleport|endteleport|persist|endpersist|stack|auth';
const BLADE_VAL = 'lang|json|yield|include|includeIf|includeWhen|includeUnless|includeFirst|each|livewire|inertia|inertiaHead|vite|viteReactRefresh|js|choice|parent|can';
const BLADE_RE = new RegExp(`^@(?:(${BLADE_VAL})|(${BLADE_CTL}))(?![A-Za-z0-9_])`);

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…', copy: '©', reg: '®', trade: '™' };
export function decodeEntities(s) {
  return s.replace(/&(?:#(\d{1,6})|#x([0-9a-f]{1,5})|([a-z]{2,8}));/gi, (m, dec, hex, name) => {
    if (dec) return String.fromCodePoint(Math.min(Number(dec), 0x10ffff));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return ENTITIES[name.toLowerCase()] ?? m;
  });
}

/** Index just past the balanced group opening at src[i] (open char), or -1. String-aware, bounded. */
export function scanBalanced(src, i, open = '(', close = ')', limit = 20000) {
  let depth = 0;
  let quote = null;
  const end = Math.min(src.length, i + limit);
  for (let j = i; j < end; j += 1) {
    const c = src[j];
    if (quote) {
      if (c === '\\') j += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === open) depth += 1;
    else if (c === close) { depth -= 1; if (depth === 0) return j + 1; }
  }
  return -1;
}

const nl = (s) => s.replace(/[^\n]/g, '');

/** Index just past the end of the JSX element starting at src[i] (`<`), or -1. Brace expressions are skipped whole. */
function scanJsxElement(src, i) {
  const n = src.length;
  let depth = 0;
  let j = i;
  for (let guard = 0; guard < 200000 && j < n; guard += 1) {
    const c = src[j];
    if (c === '{') { const e = scanBalanced(src, j, '{', '}'); if (e === -1) return -1; j = e; continue; }
    if (c !== '<') { j += 1; continue; }
    if (src[j + 1] === '/') {
      const close = src.indexOf('>', j);
      if (close === -1) return -1;
      depth -= 1;
      j = close + 1;
      if (depth <= 0) return j;
      continue;
    }
    if (!/[A-Za-z>]/.test(src[j + 1] ?? '')) { j += 1; continue; }
    // opening tag: walk to its `>` skipping strings and braces
    let k = j + 1;
    let selfClosing = false;
    for (; k < n; k += 1) {
      const d = src[k];
      if (d === '"' || d === "'") { const e = src.indexOf(d, k + 1); if (e === -1) return -1; k = e; continue; }
      if (d === '{') { const e = scanBalanced(src, k, '{', '}'); if (e === -1) return -1; k = e - 1; continue; }
      if (d === '>') { selfClosing = src[k - 1] === '/'; break; }
    }
    if (k >= n) return -1;
    j = k + 1;
    if (!selfClosing) depth += 1;
    else if (depth === 0) return j;
  }
  return -1;
}

/** Keep only the JSX regions of a source file; everything else becomes blank lines. */
function extractJsx(src) {
  const n = src.length;
  let out = '';
  let i = 0;
  let prev = '';
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += nl(src.slice(i, j + 1));
      i = j + 1;
      prev = c;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); const stop = e === -1 ? n : e; out += ' '.repeat(stop - i); i = stop; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const stop = e === -1 ? n : e + 2; out += nl(src.slice(i, stop)); i = stop; continue; }
    if (c === '<' && /[A-Za-z>]/.test(src[i + 1] ?? '') && (/[(,=:?&|{[;>]/.test(prev) || prev === '' || /\breturn\s*$/.test(src.slice(Math.max(0, i - 8), i)))) {
      const end = scanJsxElement(src, i);
      if (end !== -1) { out += src.slice(i, end); i = end; prev = '>'; continue; }
    }
    out += c === '\n' ? '\n' : ' ';
    if (!/\s/.test(c)) prev = c;
    i += 1;
  }
  return out;
}

/** Replace every match of `re` in `src` by its newlines only. */
const blank = (src, re) => src.replace(re, (m) => nl(m));

/**
 * Replace dynamic fragments by markers, return { text, exprs }.
 * `braces`: treat a single balanced `{...}` as an expression (JSX, Svelte).
 */
function neutralise(src, { blade, twig, braces }) {
  let out = '';
  const exprs = [];
  const n = src.length;
  let i = 0;
  const push = (marker, from, to) => {
    const raw = src.slice(from, to);
    if (marker === DYN) exprs.push(raw);
    out += marker + nl(raw);
  };
  while (i < n) {
    const c = src[i];
    if (c === '{') {
      if (src.startsWith('{{', i) && src[i - 1] !== '@') {
        const close = src.indexOf('}}', i + 2);
        if (close !== -1) { push(DYN, i, close + 2); i = close + 2; continue; }
      } else if (src.startsWith('{!!', i)) {
        const close = src.indexOf('!!}', i + 3);
        if (close !== -1) { push(DYN, i, close + 3); i = close + 3; continue; }
      } else if (twig && src.startsWith('{%', i)) {
        const close = src.indexOf('%}', i + 2);
        if (close !== -1) { push(CTL, i, close + 2); i = close + 2; continue; }
      } else if (braces) {
        const end = scanBalanced(src, i, '{', '}');
        if (end !== -1) { push('#:/@'.includes(src[i + 1]) && src[i + 1] !== undefined ? CTL : DYN, i, end); i = end; continue; }
      }
    } else if (c === '<' && src[i + 1] === '?') {
      const close = src.indexOf('?>', i + 2);
      if (close !== -1) { push(src.startsWith('<?=', i) ? DYN : CTL, i, close + 2); i = close + 2; continue; }
    } else if (c === '@' && blade && !/[A-Za-z0-9_.@]/.test(src[i - 1] ?? ' ')) {
      const m = BLADE_RE.exec(src.slice(i, i + 24));
      if (m) {
        let j = i + m[0].length;
        let k = j;
        while (src[k] === ' ' || src[k] === '\t') k += 1;
        if (src[k] === '(') {
          const end = scanBalanced(src, k);
          if (end !== -1) j = end;
        }
        push(m[1] ? DYN : CTL, i, j);
        i = j;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return { text: out, exprs };
}

// ---- tokeniser / tree ----------------------------------------------------------------------------

const NAME_BIND = /^(?:v-bind:|x-bind:|bind:|:)(.+)$/;
const ATTR_ALIAS = { htmlfor: 'for', classname: 'class', tabindex: 'tabindex' };

function normaliseAttrName(raw) {
  let name = raw.toLowerCase();
  let bound = false;
  const m = NAME_BIND.exec(name);
  if (m) { name = m[1]; bound = true; }
  if (/^\[.+\]$/.test(name)) { name = name.slice(1, -1); bound = true; }
  name = ATTR_ALIAS[name] ?? name;
  return { name, bound };
}

export const isComponentTag = (rawTag, kind = 'html') => /[:\-.]/.test(rawTag) || (/^[A-Z]/.test(rawTag) && (kind === 'jsx' || kind === 'vue' || kind === 'svelte'));

/**
 * Parse one template.
 * @returns {{ root, elements, texts, comments, styleBlocks, evidenceMarkers, exprs, kind, isDocument }}
 */
export function parseTemplate(source, kind) {
  let src = source;
  const comments = [];
  const evidenceMarkers = [];
  const styleBlocks = [];

  // Vue: only <template> is markup. Everything else is blanked (styles are collected first).
  const lineOf = (text, index) => { let l = 1; for (let p = text.indexOf('\n'); p !== -1 && p < index; p = text.indexOf('\n', p + 1)) l += 1; return l; };

  src = src.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (m, css, offset) => {
    styleBlocks.push({ css, line: lineOf(source, offset + m.indexOf('>') + 1) });
    return nl(m);
  });
  src = blank(src, /<script\b[\s\S]*?<\/script>/gi);
  if (kind === 'vue') {
    const open = /<template\b[^>]*>/i.exec(src);
    const close = src.lastIndexOf('</template>');
    if (open && close > open.index) {
      src = nl(src.slice(0, open.index + open[0].length)) + src.slice(open.index + open[0].length, close) + nl(src.slice(close));
    } else {
      src = nl(src);
    }
  }
  if (kind === 'svelte') src = blank(src, /<\/?svelte:[a-z]+[^>]*>/gi);
  if (kind === 'jsx') src = extractJsx(src); // only the JSX is markup; the code around it is blanked

  // Comments: record developer notes and evidence markers, then remove.
  let before = src;
  src = src.replace(/\{\{--([\s\S]*?)--\}\}/g, (m, body, off) => {
    comments.push({ text: body.trim(), line: lineOf(before, off) });
    return nl(m);
  });
  before = src;
  src = src.replace(/<!--([\s\S]*?)-->/g, (m, body, off) => {
    comments.push({ text: body.trim(), line: lineOf(before, off) });
    return nl(m);
  });
  src = src.replace(/\{#([\s\S]*?)#\}/g, (m) => nl(m));
  if (kind === 'jsx' || kind === 'svelte') {
    before = src;
    src = src.replace(/\{\s*\/\*([\s\S]*?)\*\/\s*\}/g, (m, body, off) => {
      comments.push({ text: body.trim(), line: lineOf(before, off) });
      return nl(m);
    });
  }
  for (const c of comments) {
    const em = /\bevidence:\s*(\S+)/i.exec(c.text);
    if (em) evidenceMarkers.push({ ref: em[1].replace(/[)\].,;]+$/, ''), line: c.line });
  }
  src = blank(src, /@php\b[\s\S]*?@endphp/g);
  src = blank(src, /@verbatim\b[\s\S]*?@endverbatim/g);

  const { text: neutral, exprs } = neutralise(src, { blade: kind === 'blade' || kind === 'html', twig: kind === 'twig', braces: kind === 'jsx' || kind === 'svelte' });

  // Position of each DYN marker, to map an attribute's markers back to `exprs`.
  const dynPos = [];
  for (let p = neutral.indexOf(DYN); p !== -1; p = neutral.indexOf(DYN, p + 1)) dynPos.push(p);
  const exprsBetween = (from, to) => {
    let lo = 0;
    let hi = dynPos.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (dynPos[mid] < from) lo = mid + 1; else hi = mid; }
    const out = [];
    for (let k = lo; k < dynPos.length && dynPos[k] < to; k += 1) out.push(exprs[k]);
    return out;
  };

  const lineStarts = [0];
  for (let p = neutral.indexOf('\n'); p !== -1; p = neutral.indexOf('\n', p + 1)) lineStarts.push(p + 1);
  const lineAtPos = (pos) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };

  const root = { type: 'root', tag: '#root', children: [], parent: null, line: 1 };
  const elements = [];
  const texts = [];
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const len = neutral.length;
  let i = 0;
  let textStart = -1;

  const flushText = (end) => {
    if (textStart === -1) return;
    const raw = neutral.slice(textStart, end);
    textStart = -1;
    if (raw.trim() === '' || raw.replaceAll(CTL, '').trim() === '') return;
    // JSX/Svelte: text outside any element is code, not copy.
    if ((kind === 'jsx') && top() === root) return;
    const lead = raw.length - raw.trimStart().length;
    const node = { type: 'text', text: raw, lead, line: lineAtPos(end - raw.length + lead), parent: top() };
    top().children.push(node);
    texts.push(node);
  };

  while (i < len) {
    const c = neutral[i];
    if (c !== '<') { if (textStart === -1) textStart = i; i += 1; continue; }
    const next = neutral[i + 1];
    if (next === '!' || next === '?') { flushText(i); const close = neutral.indexOf('>', i); i = close === -1 ? len : close + 1; continue; }
    if (next === '/') {
      const m = /^<\/([A-Za-z][A-Za-z0-9:_.-]*)\s*>/.exec(neutral.slice(i, i + 80));
      if (!m) { if (textStart === -1) textStart = i; i += 1; continue; }
      flushText(i);
      const tag = m[1].toLowerCase();
      for (let s = stack.length - 1; s > 0; s -= 1) {
        if (stack[s].tag === tag) { stack.length = s; break; }
      }
      i += m[0].length;
      continue;
    }
    const nm = /^<([A-Za-z][A-Za-z0-9:_.-]*)/.exec(neutral.slice(i, i + 80));
    if (!nm) { if (textStart === -1) textStart = i; i += 1; continue; }

    flushText(i);
    const rawTag = nm[1];
    const tag = rawTag.toLowerCase();
    const el = { type: 'el', tag, rawTag, attrs: new Map(), children: [], parent: top(), line: lineAtPos(i), dynamicAttrs: false, selfClosing: false, component: isComponentTag(rawTag, kind) };
    let j = i + nm[0].length;
    let closed = false;
    while (j < len) {
      while (j < len && /\s/.test(neutral[j])) j += 1;
      const ch = neutral[j];
      if (ch === undefined) break;
      if (ch === '>') { j += 1; closed = true; break; }
      if (ch === '/' && neutral[j + 1] === '>') { el.selfClosing = true; j += 2; closed = true; break; }
      if (ch === '/') { j += 1; continue; }
      if (ch === CTL) { j += 1; continue; }
      if (ch === DYN) { el.dynamicAttrs = true; j += 1; continue; }
      if (ch === '<') break; // malformed: a new tag started
      let k = j;
      while (k < len && !/[\s=>]/.test(neutral[k]) && !(neutral[k] === '/' && neutral[k + 1] === '>') && neutral[k] !== DYN && neutral[k] !== CTL) k += 1;
      if (k === j) { j += 1; continue; }
      const rawName = neutral.slice(j, k);
      j = k;
      let value = '';
      let hasValue = false;
      let valueExprs = [];
      let ws = j;
      while (ws < len && /\s/.test(neutral[ws])) ws += 1;
      if (neutral[ws] === '=') {
        hasValue = true;
        j = ws + 1;
        while (j < len && /\s/.test(neutral[j])) j += 1;
        const q = neutral[j];
        if (q === '"' || q === "'") {
          const end = neutral.indexOf(q, j + 1);
          const stop = end === -1 ? len : end;
          value = neutral.slice(j + 1, stop);
          valueExprs = exprsBetween(j + 1, stop);
          j = end === -1 ? len : end + 1;
        } else {
          let e = j;
          while (e < len && !/[\s>]/.test(neutral[e]) && !(neutral[e] === '/' && neutral[e + 1] === '>')) e += 1;
          value = neutral.slice(j, e);
          valueExprs = exprsBetween(j, e);
          j = e;
        }
      }
      const { name, bound } = normaliseAttrName(rawName);
      if (name === 'v-bind' || name === 'x-bind' || name === '...') { el.dynamicAttrs = true; continue; }
      const dynamic = bound || value.includes(DYN);
      if (!el.attrs.has(name)) el.attrs.set(name, { name, value: value.replaceAll(CTL, ''), dynamic, hasValue, exprs: valueExprs, line: lineAtPos(i) });
    }
    if (!closed && j >= len) { /* unterminated tag at EOF: keep the element, no children */ }

    // Implied end tags for the few elements where HTML closes them silently.
    if (AUTOCLOSE.has(tag) && top().tag === tag) stack.pop();
    el.parent = top();
    top().children.push(el);
    elements.push(el);
    if (!el.selfClosing && !VOID.has(tag)) stack.push(el);
    i = j;
  }
  flushText(len);

  return {
    root,
    elements,
    texts,
    comments,
    styleBlocks,
    evidenceMarkers,
    exprs,
    kind,
    isDocument: elements.some((e) => e.tag === 'html'),
  };
}

// ---- tree helpers --------------------------------------------------------------------------------

export function* descendants(node) {
  for (const child of node.children ?? []) {
    yield child;
    if (child.type === 'el') yield* descendants(child);
  }
}

export function closest(el, pred) {
  for (let p = el.parent; p && p.type === 'el'; p = p.parent) if (pred(p)) return p;
  return null;
}

export const attr = (el, name) => el.attrs.get(name);
export const hasAttr = (el, name) => el.attrs.has(name);
/** Literal value of an attribute, or null when absent. Dynamic values come back with markers. */
export const attrValue = (el, name) => (el.attrs.has(name) ? el.attrs.get(name).value : null);

/** Text content of an element (markers kept: DYN means "something is output here"). */
export function textOf(el) {
  let s = '';
  for (const n of descendants(el)) if (n.type === 'text') s += n.text;
  return s.replaceAll(CTL, '');
}

/** 1-based line of a character offset inside a text node's raw text. */
export const lineInText = (node, offset) => node.line + (node.text.slice(node.lead, Math.max(offset, node.lead)).match(/\n/g)?.length ?? 0);
