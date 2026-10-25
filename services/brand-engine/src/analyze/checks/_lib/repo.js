// services/brand-engine/src/analyze/checks/_lib/repo.js
//
// The one place the built-in checks touch the file system. Read-only, bounded and
// confined to the checkout:
//
//   * every path is resolved against the REAL path of ctx.root, and a file whose
//     real path is not inside it is never read (so a symlink out of the root is
//     ignored, and so is `../x` or an absolute path);
//   * directories that are symlinks are never entered;
//   * vendor/, node_modules/, build output, .git/ and minified files are skipped;
//   * files over MAX_BYTES are skipped, never truncated and half-read; the total read
//     is bounded.
//
// Two backends, one interface. When the analyzer hands over ctx.files (list/read/exists)
// the Repo lists and reads through it, so the analysis report knows what was skipped and
// why (coverage.skipped); every path it returns is re-validated here, and a throwing
// or hostile provider degrades to "unreadable", never to a read outside the root. When
// there is no usable ctx.files (a direct call, a test) the Repo walks ctx.root itself
// with the same rules. A Repo is cached per ctx (WeakMap).
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, posix, sep } from 'node:path';
import { inScope } from '../../scope.js';

export const MAX_BYTES = 1024 * 1024; // the same cap as the analyzer's file API
export const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
export const MAX_ENTRIES = 100_000;
const MAX_LINE_CHARS = 10_000; // a longer line in css/html is minified or generated

// Directory names that are never entered (any depth).
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'vendor', 'bower_components', 'build', 'dist', 'out', '.next', '.nuxt', '.svelte-kit',
  '.output', '.turbo', '.cache', 'coverage', '.nyc_output', 'target', '.idea', '.vscode', '__pycache__', '.venv',
]);
// Relative directory paths that are build output or runtime state, not source.
const SKIP_PATHS = ['public/build', 'public/hot', 'storage', 'bootstrap/cache', 'public/vendor', 'public/js', 'public/dist'];

const TEMPLATE_EXT = /\.(?:blade\.php|html?|vue|svelte|jsx|tsx|twig)$/i;
const STYLE_EXT = /\.(?:css|scss|sass|less|pcss)$/i;

export const kindOf = (rel) => {
  const lower = rel.toLowerCase();
  if (lower.endsWith('.blade.php')) return 'blade';
  if (/\.html?$/.test(lower)) return 'html';
  if (lower.endsWith('.vue')) return 'vue';
  if (lower.endsWith('.svelte')) return 'svelte';
  if (/\.(?:jsx|tsx)$/.test(lower)) return 'jsx';
  if (lower.endsWith('.twig')) return 'twig';
  if (STYLE_EXT.test(lower)) return 'style';
  if (/\.php$/.test(lower)) return 'php';
  if (/\.json$/.test(lower)) return 'json';
  if (/\.md$/.test(lower)) return 'md';
  return 'other';
};

function hasLongLine(text) {
  let from = 0;
  for (let i = text.indexOf('\n'); ; i = text.indexOf('\n', from)) {
    const end = i === -1 ? text.length : i;
    if (end - from > MAX_LINE_CHARS) return true;
    if (i === -1) return false;
    from = i + 1;
  }
}

const isMinified = (rel) => /\.min\.[a-z0-9]+$/i.test(rel) || /-min\.[a-z0-9]+$/i.test(rel);

/** Normalise a caller-supplied relative path, or null when it could leave the root. */
export function safeRel(rel) {
  if (typeof rel !== 'string' || rel === '' || rel.includes('\0')) return null;
  if (isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || rel.startsWith('/') || rel.startsWith('\\')) return null;
  const norm = posix.normalize(rel.replaceAll('\\', '/'));
  if (norm === '..' || norm.startsWith('../') || norm === '.' ) return null;
  return norm;
}

const cache = new WeakMap();

export function openRepo(ctx) {
  if (ctx !== null && typeof ctx === 'object' && cache.has(ctx)) return cache.get(ctx);
  const repo = new Repo(ctx);
  if (ctx !== null && typeof ctx === 'object') cache.set(ctx, repo);
  return repo;
}

const usableProvider = (f) => f !== null && typeof f === 'object' && typeof f.list === 'function' && typeof f.read === 'function';

export class Repo {
  constructor(ctx) {
    this.ok = false;
    this.truncated = false;
    this.skipped = { symlink: 0, large: 0, minified: 0, unreadable: 0, budget: 0 };
    this.backend = 'walk';
    this._text = new Map();
    this._derived = new Map();
    this._totalRead = 0;
    this.entries = [];
    this._all = new Set();
    // --scope: path prefixes that limit which files list() offers as a surface. exists()/read() and
    // listAll() still see the whole checkout, because a link in an in-scope template is resolved
    // against routes that live elsewhere.
    this.scope = Array.isArray(ctx?.scope) ? ctx.scope.map(safeRel).filter((p) => p !== null) : [];
    try {
      const rootPath = ctx?.root;
      if (typeof rootPath !== 'string' || rootPath === '') throw new Error('no root');
      this.root = realpathSync(rootPath);
      if (!statSync(this.root).isDirectory()) throw new Error('not a directory');
      this.ok = true;
    } catch {
      this.root = null;
      return;
    }
    this._provider = usableProvider(ctx?.files) ? ctx.files : null;
    if (!(this._provider && this._listViaProvider())) {
      this._provider = null;
      this._walk();
    }
    this.entries.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  }

  /** List through the analyzer's file API. Returns false when it cannot be used. */
  _listViaProvider() {
    let listed;
    try {
      listed = this._provider.list(['**/*']);
    } catch {
      return false;
    }
    if (!Array.isArray(listed)) return false;
    this.backend = 'provider';
    for (const raw of listed) {
      if (this.entries.length >= MAX_ENTRIES) { this.truncated = true; break; }
      const rel = safeRel(raw);
      if (rel === null || rel !== raw) continue; // only canonical relative paths
      if (this._skippedByName(rel)) continue;
      this._all.add(rel);
      this.entries.push({ rel, kind: kindOf(rel) });
    }
    return true;
  }

  _skippedByName(rel) {
    const parts = rel.split('/');
    if (parts.slice(0, -1).some((p) => SKIP_DIRS.has(p))) return true;
    if (SKIP_PATHS.some((sp) => rel === sp || rel.startsWith(`${sp}/`))) return true;
    if (isMinified(rel)) { this.skipped.minified += 1; return true; }
    return false;
  }

  _inside(abs) {
    return abs === this.root || abs.startsWith(this.root + sep);
  }

  _walk() {
    const stack = [''];
    let count = 0;
    while (stack.length) {
      const relDir = stack.pop();
      let dirents;
      try {
        dirents = readdirSync(join(this.root, relDir), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const d of dirents) {
        if (++count > MAX_ENTRIES) { this.truncated = true; return; }
        const rel = relDir === '' ? d.name : `${relDir}/${d.name}`;
        if (d.isDirectory()) {
          if (SKIP_DIRS.has(d.name) || SKIP_PATHS.includes(rel)) continue;
          stack.push(rel);
          continue;
        }
        let isFile = d.isFile();
        if (d.isSymbolicLink()) {
          // Never follow a symlinked directory; follow a symlinked file only if it stays inside the root.
          try {
            const real = realpathSync(join(this.root, rel));
            if (!this._inside(real) || !statSync(real).isFile()) { this.skipped.symlink += 1; continue; }
            isFile = true;
          } catch {
            this.skipped.symlink += 1;
            continue;
          }
        }
        if (!isFile) continue;
        if (isMinified(rel)) { this.skipped.minified += 1; continue; }
        this._all.add(rel);
        this.entries.push({ rel, kind: kindOf(rel) });
      }
    }
  }

  /** True when the (safe, in-root, non-ignored) relative path is a file in the checkout. */
  exists(rel) {
    const r = safeRel(rel);
    return r !== null && this._all.has(r);
  }

  /** True for a directory that holds at least one scanned file (used for routes/, tests/, ...). */
  hasDir(rel) {
    const r = safeRel(rel);
    if (r === null) return false;
    const prefix = `${r.replace(/\/$/, '')}/`;
    return this.entries.some((e) => e.rel.startsWith(prefix));
  }

  /** True when the path is part of the surface under analysis (always true without a scope). */
  inScope(rel) {
    return inScope(this.scope, rel);
  }

  /** Relative paths of the SURFACE files (those in scope) matching a predicate on (rel, kind), sorted. */
  list(pred = () => true) {
    return this.entries.filter((e) => this.inScope(e.rel) && pred(e.rel, e.kind)).map((e) => e.rel);
  }

  /** Like list(), but over the whole checkout: for inventories of what exists (routes, handlers), never for what is judged. */
  listAll(pred = () => true) {
    return this.entries.filter((e) => pred(e.rel, e.kind)).map((e) => e.rel);
  }

  /** File content as UTF-8, or null (missing, outside the root, too large, binary, minified, unreadable, over budget). */
  read(rel) {
    const r = safeRel(rel);
    if (r === null || !this._all.has(r)) return null;
    if (this._text.has(r)) return this._text.get(r);
    let text = this._provider ? this._readViaProvider(r) : this._readDirect(r);
    if (text !== null) {
      this._totalRead += text.length;
      if (this._totalRead > MAX_TOTAL_BYTES) { this.skipped.budget += 1; text = null; }
    }
    if (text !== null) text = text.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    this._text.set(r, text);
    return text;
  }

  _readViaProvider(r) {
    try {
      const t = this._provider.read(r);
      return typeof t === 'string' ? t : null;
    } catch (error) {
      const code = error && typeof error === 'object' ? error.code : undefined;
      if (code === 'TOO_LARGE') this.skipped.large += 1;
      else if (code === 'MINIFIED') this.skipped.minified += 1;
      else if (code === 'BUDGET') this.skipped.budget += 1;
      else this.skipped.unreadable += 1;
      return null;
    }
  }

  _readDirect(r) {
    try {
      const real = realpathSync(join(this.root, r));
      if (!this._inside(real)) { this.skipped.symlink += 1; return null; }
      const st = lstatSync(real);
      if (!st.isFile()) return null;
      if (st.size > MAX_BYTES) { this.skipped.large += 1; return null; }
      const buf = readFileSync(real);
      if (buf.subarray(0, 8000).includes(0)) { this.skipped.unreadable += 1; return null; }
      const text = buf.toString('utf8');
      const kind = kindOf(r);
      if ((kind === 'style' || kind === 'html') && hasLongLine(text)) { this.skipped.minified += 1; return null; }
      return text;
    } catch {
      this.skipped.unreadable += 1;
      return null;
    }
  }

  /** One short sentence about what was not read, or '' when everything was. For a check's detail. */
  coverageNote() {
    const k = this.skipped;
    const parts = [];
    if (k.large) parts.push(`${k.large} over the size cap`);
    if (k.minified) parts.push(`${k.minified} minified or generated`);
    if (k.budget) parts.push(`${k.budget} past the read budget`);
    if (k.unreadable) parts.push(`${k.unreadable} unreadable or binary`);
    if (k.symlink) parts.push(`${k.symlink} symlinked file(s) leaving the checkout`);
    if (this.truncated) parts.push('the file list was cut short');
    return parts.length ? ` Not read: ${parts.join(', ')}.` : '';
  }

  /** Memoise a derived value (parsed templates, token tables) for this run. */
  memo(key, build) {
    if (!this._derived.has(key)) this._derived.set(key, build());
    return this._derived.get(key);
  }
}

// ---- what counts as "user facing" ---------------------------------------------------------------

const NON_UI_DIR = /(?:^|\/)(?:tests?|__tests__|spec|specs|e2e|cypress|playwright|fixtures?|__fixtures__|stories|storybook|docs?|documentation|examples?|samples?|stubs?|node_modules|vendor)(?:\/|$)/i;

/** Templates that ship to users: not tests, fixtures, docs or examples. */
export const isShippedTemplate = (rel) => TEMPLATE_EXT.test(rel) && !NON_UI_DIR.test(rel) && !/(?:^|\/)stubs?\//i.test(rel);

/** Style sources a product ships: not tests, docs, vendor or generated bundles. */
export const isShippedStyle = (rel) => STYLE_EXT.test(rel) && !NON_UI_DIR.test(rel);

/** Mail templates and test doubles are not screens. */
export const isScreenTemplate = (rel) => isShippedTemplate(rel)
  && !/(?:^|\/)(?:layouts?|components?|partials?|includes?|emails?|mails?|vendor|livewire|widgets?|macros?|snippets?)(?:\/|$)/i.test(rel)
  && !/(?:^|\/)_[^/]*$/.test(rel);

/** Count of line breaks before `index` plus one. */
export function lineAt(text, index) {
  let line = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) line += 1;
  return line;
}

/** Index of the start of each line, for repeated lineAt calls on one text. */
export function lineIndex(text) {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}
