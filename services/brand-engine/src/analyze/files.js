// services/brand-engine/src/analyze/files.js
//
// The file API a check receives as ctx.files. It is READ-ONLY and CONFINED to
// one checkout root:
//   - a path is relative, uses "/", has no "..", no NUL and no backslash;
//   - a symlink is followed only if its real path stays inside the root, and a
//     directory symlink is never walked;
//   - vendored, generated and VCS directories, credential-shaped file names,
//     minified files, binary files and files over the size cap are not
//     readable, and the reason is recorded (skipped()) so the analysis can say
//     what it did not look at;
//   - the total bytes one check may read is bounded.
//
//   list(globs)  -> sorted relative paths matching any glob ("!" excludes)
//   read(rel)    -> string, or null if the file does not exist; THROWS
//                   FileAccessError (code) for INVALID_PATH, DENIED, ESCAPE,
//                   NOT_A_FILE, TOO_LARGE, BINARY, MINIFIED, BUDGET
//   exists(rel)  -> boolean; false (never a throw) for anything unreadable
//
// Races (a path swapped between check and read) are bounded, not eliminated:
// the real path is re-checked after the file is opened.
import { closeSync, fstatSync, lstatSync, openSync, readdirSync, readSync, realpathSync } from 'node:fs';
import { constants } from 'node:fs';
import { join, sep } from 'node:path';
import { FILE_LIMITS, SKIP_DIRS, SKIP_PATHS } from './limits.js';
import { byText } from './text.js';

export class FileAccessError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FileAccessError';
    this.code = code;
  }
}

const SKIP_DIR_SET = new Set(SKIP_DIRS);
const LINE_CHECKED = /\.(?:css|scss|sass|less|js|mjs|cjs|jsx|ts|tsx|html?|vue|svelte|astro)$/i;
const SENSITIVE = [
  /^\.env$/i, /^\.env\.(?!example$|sample$|dist$|template$)/i, /\.(?:pem|key|p12|pfx|jks|keystore)$/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)/i, /^\.npmrc$/i, /^\.netrc$/i, /^\.pgpass$/i, /^\.htpasswd$/i,
  /^credentials(?:\.json|\.ya?ml)?$/i, /^secrets?\.(?:json|ya?ml|toml)$/i,
];
const MINIFIED_NAME = /(?:\.|-)min\.(?:js|css|mjs)$/i;
const MAP_NAME = /\.map$/i;

/** Validate and normalise a relative path. Returns the "/"-joined path or throws INVALID_PATH. */
export function normaliseRel(rel) {
  if (typeof rel !== 'string' || rel.length === 0) throw new FileAccessError('INVALID_PATH', 'path must be a non-empty string');
  if (rel.length > FILE_LIMITS.maxPathLength) throw new FileAccessError('INVALID_PATH', 'path is too long');
  if (rel.includes('\0')) throw new FileAccessError('INVALID_PATH', 'path contains NUL');
  if (rel.includes('\\')) throw new FileAccessError('INVALID_PATH', 'path must use "/" separators');
  if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) throw new FileAccessError('INVALID_PATH', 'path must be relative');
  const parts = [];
  for (const part of rel.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') throw new FileAccessError('INVALID_PATH', 'path must not contain ".."');
    parts.push(part);
  }
  if (parts.length === 0) throw new FileAccessError('INVALID_PATH', 'path is empty');
  return parts.join('/');
}

const deniedReason = (rel) => {
  const parts = rel.split('/');
  if (parts.some((p) => SKIP_DIR_SET.has(p))) return 'vendored_or_generated_directory';
  for (const sp of SKIP_PATHS) if (rel === sp || rel.startsWith(`${sp}/`)) return 'vendored_or_generated_directory';
  const name = parts[parts.length - 1];
  if (SENSITIVE.some((re) => re.test(name))) return 'sensitive_name';
  return null;
};

// ---------- globs ----------

/** Translate a glob to a RegExp: ** (any depth), * (no "/"), ? (one char), {a,b}. No backtracking traps. */
export function globToRegExp(glob) {
  if (typeof glob !== 'string' || glob.length === 0 || glob.length > FILE_LIMITS.maxGlobLength) throw new TypeError('glob must be a non-empty string of at most 200 characters');
  if (glob.startsWith('/') || glob.includes('\0') || glob.split('/').includes('..')) throw new TypeError('glob must be relative with no ".."');
  let out = '';
  let braceDepth = 0;
  let stars = 0;
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      stars += 1;
      if (stars > 8) throw new TypeError('glob has too many wildcards');
      if (glob[i + 1] === '*') {
        i += 1;
        if (glob[i + 1] === '/') { i += 1; out += '(?:[^/]+/)*'; } else out += '.*';
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if (c === '{') { braceDepth += 1; if (braceDepth > 3) throw new TypeError('glob braces nested too deeply'); out += '(?:'; }
    else if (c === '}' && braceDepth > 0) { braceDepth -= 1; out += ')'; }
    else if (c === ',' && braceDepth > 0) out += '|';
    else out += c.replace(/[.+^$()|[\]\\{}/]/g, '\\$&');
  }
  if (braceDepth !== 0) throw new TypeError('glob has an unclosed brace');
  return new RegExp(`^${out}$`);
}

function compileGlobs(globs) {
  const list = Array.isArray(globs) ? globs : [globs];
  if (list.length === 0 || list.length > FILE_LIMITS.maxGlobs) throw new TypeError('provide between 1 and 50 globs');
  const include = [];
  const exclude = [];
  for (const g of list) {
    if (typeof g === 'string' && g.startsWith('!')) exclude.push(globToRegExp(g.slice(1)));
    else include.push(globToRegExp(g));
  }
  return (rel) => include.some((re) => re.test(rel)) && !exclude.some((re) => re.test(rel));
}

// ---------- the API ----------

/**
 * createFiles(root, limits?) -> { api: {list, read, exists}, skipped(), root }
 * `root` must already be an existing directory; it is resolved once.
 */
export function createFiles(root, limits = FILE_LIMITS) {
  const realRoot = realpathSync(root);
  const skipped = new Map(); // `${reason}|${path}` -> {path, reason}
  let walked = null;
  let totalRead = 0;

  const note = (path, reason) => { const key = `${reason}|${path}`; if (!skipped.has(key)) skipped.set(key, { path, reason }); };
  const inside = (real) => real === realRoot || real.startsWith(realRoot + sep);

  function walk() {
    if (walked) return walked;
    const files = [];
    const queue = [{ rel: '', depth: 0 }];
    outer: while (queue.length) {
      const { rel, depth } = queue.shift();
      let entries;
      try { entries = readdirSync(join(realRoot, rel), { withFileTypes: true }); } catch { note(rel || '.', 'unreadable_directory'); continue; }
      entries.sort((a, b) => byText(a.name, b.name));
      for (const e of entries) {
        const child = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (SKIP_DIR_SET.has(e.name) || SKIP_PATHS.includes(child)) { note(child, 'vendored_or_generated_directory'); continue; }
          if (depth + 1 > limits.maxDepth) { note(child, 'too_deep'); continue; }
          queue.push({ rel: child, depth: depth + 1 });
        } else if (e.isSymbolicLink()) {
          let real;
          try { real = realpathSync(join(realRoot, child)); } catch { note(child, 'broken_symlink'); continue; }
          if (!inside(real)) { note(child, 'symlink_escapes_root'); continue; }
          let st;
          try { st = lstatSync(real); } catch { continue; }
          if (!st.isFile()) { note(child, 'symlink_not_a_file'); continue; }
          if (!accept(child)) continue;
          files.push(child);
        } else if (e.isFile()) {
          if (!accept(child)) continue;
          files.push(child);
          if (files.length >= limits.maxListedFiles) { note(child, 'file_limit'); break outer; }
        }
      }
    }
    files.sort(byText);
    walked = files;
    return walked;
  }

  function accept(rel) {
    const why = deniedReason(rel);
    if (why) { note(rel, why); return false; }
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    if (MINIFIED_NAME.test(name) || MAP_NAME.test(name)) { note(rel, 'minified_or_generated'); return false; }
    return true;
  }

  const api = {
    list(globs) {
      const match = compileGlobs(globs);
      return walk().filter(match);
    },

    exists(rel) {
      try {
        const clean = normaliseRel(rel);
        if (deniedReason(clean)) return false;
        const real = realpathSync(join(realRoot, ...clean.split('/')));
        return inside(real);
      } catch {
        return false;
      }
    },

    read(rel) {
      const clean = normaliseRel(rel);
      const why = deniedReason(clean);
      if (why) { note(clean, why); throw new FileAccessError('DENIED', `${clean}: not readable (${why})`); }
      const full = join(realRoot, ...clean.split('/'));
      let real;
      try {
        lstatSync(full);
        real = realpathSync(full);
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
        throw new FileAccessError('DENIED', `${clean}: cannot be read (${error.code ?? 'error'})`);
      }
      if (!inside(real)) { note(clean, 'symlink_escapes_root'); throw new FileAccessError('ESCAPE', `${clean}: resolves outside the checkout`); }

      let fd;
      try {
        fd = openSync(real, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const st = fstatSync(fd);
        if (!st.isFile()) throw new FileAccessError('NOT_A_FILE', `${clean}: not a regular file`);
        if (st.size > limits.maxFileBytes) { note(clean, 'over_size_cap'); throw new FileAccessError('TOO_LARGE', `${clean}: larger than ${limits.maxFileBytes} bytes`); }
        if (totalRead + st.size > limits.maxTotalReadBytes) throw new FileAccessError('BUDGET', 'read budget for this check is exhausted');
        // Re-check after open: a path swapped for a link in the meantime must not escape.
        if (!inside(realpathSync(full))) { note(clean, 'symlink_escapes_root'); throw new FileAccessError('ESCAPE', `${clean}: resolves outside the checkout`); }
        const buffer = Buffer.alloc(st.size);
        let offset = 0;
        while (offset < st.size) {
          const n = readSync(fd, buffer, offset, st.size - offset, offset);
          if (n === 0) break;
          offset += n;
        }
        totalRead += offset;
        const bytes = buffer.subarray(0, offset);
        if (bytes.subarray(0, 8000).includes(0)) { note(clean, 'binary'); throw new FileAccessError('BINARY', `${clean}: binary file`); }
        const text = bytes.toString('utf8');
        if (LINE_CHECKED.test(clean) && text.split('\n').some((line) => line.length > limits.maxLineChars)) {
          note(clean, 'minified_or_generated');
          throw new FileAccessError('MINIFIED', `${clean}: has a line over ${limits.maxLineChars} characters (minified or generated)`);
        }
        return text;
      } catch (error) {
        if (error instanceof FileAccessError) throw error;
        if (error.code === 'ELOOP') { note(clean, 'symlink_escapes_root'); throw new FileAccessError('ESCAPE', `${clean}: is a symlink`); }
        if (error.code === 'ENOENT') return null;
        throw new FileAccessError('DENIED', `${clean}: cannot be read (${error.code ?? 'error'})`);
      } finally {
        if (fd !== undefined) closeSync(fd);
      }
    },
  };

  return {
    api: Object.freeze(api),
    root: realRoot,
    /** Everything the API declined to list or read, sorted. */
    skipped: () => [...skipped.values()].sort((a, b) => byText(`${a.path}|${a.reason}`, `${b.path}|${b.reason}`)),
  };
}
