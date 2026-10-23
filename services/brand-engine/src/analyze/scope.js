// services/brand-engine/src/analyze/scope.js
//
// --scope <path-prefix[,..]>: limit the static checks to one surface of a checkout.
//
// A scope is a short list of repo-relative path PREFIXES (a directory or a single file),
// never a glob. Every prefix is confined: relative, "/"-separated, no "..", no NUL, no
// backslash, no drive letter, no wildcard, no comma (the separator), and, when it exists,
// its real path must stay inside the checkout (a symlink that leaves it is refused).
//
// What a scope does (and does not do), in one place:
//   * it limits the files a check LISTS as a surface: templates, stylesheets and language
//     files. Two scopes of one repository therefore see different templates and different
//     blockers (the Phase 1 defect D1);
//   * it does NOT hide support files. Routes, composer.json, DESIGN.md, PRODUCT.md and
//     the like are still read (exists/read) because a link in an in-scope template must
//     be resolved against the application's routes, wherever they live;
//   * the canonical label (sorted, de-duplicated, comma-joined) is what analysis.json,
//     the evidence file and the score report record as `input.scope`, so a report always
//     says which part of the product it is about.
import { realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { FILE_LIMITS } from './limits.js';

export const SCOPE_LIMITS = Object.freeze({ maxPrefixes: 20, maxLabelChars: 300 });

export class ScopeError extends Error {
  constructor(message) { super(message); this.name = 'ScopeError'; }
}

/** Normalise one prefix, or throw ScopeError naming what is wrong. */
function normalisePrefix(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') throw new ScopeError('--scope has an empty path prefix');
  const value = raw.trim();
  if (value.length > FILE_LIMITS.maxPathLength) throw new ScopeError('--scope has a path prefix that is too long');
  if (value.includes('\0')) throw new ScopeError('--scope has a path prefix with a NUL character');
  if (value.includes('\\')) throw new ScopeError(`--scope path prefixes use "/" separators (${JSON.stringify(value.slice(0, 60))})`);
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) throw new ScopeError(`--scope path prefixes are relative to the checkout (${JSON.stringify(value.slice(0, 60))} is absolute)`);
  if (/[*?[\]{}]/.test(value)) throw new ScopeError(`--scope takes path prefixes, not globs (${JSON.stringify(value.slice(0, 60))})`);
  const parts = [];
  for (const part of value.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') throw new ScopeError(`--scope path prefixes may not contain ".." (${JSON.stringify(value.slice(0, 60))})`);
    parts.push(part);
  }
  if (parts.length === 0) throw new ScopeError('--scope path prefix names no path (use a directory or file inside the checkout)');
  return parts.join('/');
}

/**
 * Parse the value of --scope (a comma-separated list). Returns { prefixes, label } with the
 * prefixes sorted and de-duplicated, and a prefix that lies under another one dropped.
 */
export function parseScope(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new ScopeError('--scope needs at least one path prefix');
  const raw = value.split(',').map(normalisePrefix);
  const sorted = [...new Set(raw)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (sorted.length > SCOPE_LIMITS.maxPrefixes) throw new ScopeError(`--scope has more than ${SCOPE_LIMITS.maxPrefixes} path prefixes`);
  const prefixes = sorted.filter((p, i) => !sorted.some((q, j) => j !== i && q !== p && p.startsWith(`${q}/`)));
  const label = prefixes.join(',');
  if (label.length > SCOPE_LIMITS.maxLabelChars) throw new ScopeError(`--scope is longer than ${SCOPE_LIMITS.maxLabelChars} characters once normalised`);
  return { prefixes, label };
}

/** Is `rel` (a canonical relative path) at or under one of the prefixes? An empty list means "everything". */
export function inScope(prefixes, rel) {
  if (!prefixes || prefixes.length === 0) return true;
  return prefixes.some((p) => rel === p || rel.startsWith(`${p}/`));
}

/**
 * Confine the prefixes to a real checkout and make sure each one names something that exists.
 * `listed` is the sorted list of files the engine can see (files.js). Throws ScopeError.
 */
export function assertScopeUsable(prefixes, realRoot, listed) {
  for (const p of prefixes) {
    let real = null;
    try { real = realpathSync(join(realRoot, ...p.split('/'))); } catch { /* may be a path the walker skips; checked below */ }
    if (real !== null && real !== realRoot && !real.startsWith(realRoot + sep)) throw new ScopeError(`--scope ${JSON.stringify(p)} resolves outside the checkout`);
    if (real === null && !listed.some((f) => f === p || f.startsWith(`${p}/`))) throw new ScopeError(`--scope ${JSON.stringify(p)} matches no file or directory in the checkout`);
    if (real !== null && !listed.some((f) => f === p || f.startsWith(`${p}/`))) {
      throw new ScopeError(`--scope ${JSON.stringify(p)} holds no file the engine can read (it may be vendored, generated, hidden or empty)`);
    }
  }
}
