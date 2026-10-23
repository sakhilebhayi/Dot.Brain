// services/brand-engine/src/drift.js
//
// A profile cites files in a repository by path + sha256 instead of copying
// their content. Drift is the cited file no longer matching what was
// recorded: changed, missing or unreadable. The recorded commit is
// informational only (this check reads a directory, not git history), so a
// profile is only as fresh as its hashes.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { checkRelativePath } from './rules.js';

export const MAX_CITED_BYTES = 10 * 1024 * 1024;

export class DriftUsageError extends Error {}

export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Check the profile's OWN source_refs (not inherited ones: those belong to the
 * parent's repository) against a checkout at `root`.
 * With refs in more than one repository, `repo` must say which one `root` is.
 */
export function checkDrift(profile, { root, repo }) {
  const all = profile.visual_direction?.source_refs ?? [];
  const repos = [...new Set(all.map((r) => r.repo))].sort();
  if (repos.length > 1 && repo === undefined) {
    throw new DriftUsageError(`source_refs span ${repos.length} repositories (${repos.join(', ')}); pass --repo <owner/name> to say which one --root is`);
  }
  if (repo !== undefined && !repos.includes(repo) && all.length > 0) {
    throw new DriftUsageError(`profile cites no files in ${repo}; it cites ${repos.join(', ')}`);
  }

  let realRoot;
  try {
    realRoot = realpathSync(root);
  } catch {
    throw new DriftUsageError('--root is not a readable directory');
  }

  const checked = [];
  const skipped = [];
  for (const ref of [...all].sort((a, b) => (`${a.repo}/${a.path}` < `${b.repo}/${b.path}` ? -1 : 1))) {
    if (repo !== undefined && ref.repo !== repo) { skipped.push({ repo: ref.repo, path: ref.path }); continue; }
    checked.push(checkOne(ref, realRoot));
  }
  const drifted = checked.filter((c) => c.status !== 'ok');
  return { checked, skipped, drifted: drifted.length, ok: drifted.length === 0 };
}

function checkOne(ref, realRoot) {
  const base = { repo: ref.repo, path: ref.path, recorded_sha256: ref.sha256 };
  const bad = checkRelativePath(ref.path);
  if (bad) return { ...base, status: 'unreadable', detail: `unsafe path: ${bad}` };
  const full = join(realRoot, ...ref.path.split('/'));
  let real;
  try {
    const st = lstatSync(full);
    if (st.isSymbolicLink()) {
      real = realpathSync(full);
    } else if (!st.isFile()) {
      return { ...base, status: 'unreadable', detail: 'not a regular file' };
    } else {
      real = full;
    }
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { ...base, status: 'missing' };
    return { ...base, status: 'unreadable', detail: error.code ?? 'cannot stat' };
  }
  // A link (or a link in the path) may not carry the read outside the checkout.
  try {
    real = realpathSync(real);
  } catch {
    return { ...base, status: 'missing' };
  }
  if (real !== realRoot && !real.startsWith(realRoot + sep)) {
    return { ...base, status: 'unreadable', detail: 'resolves outside --root' };
  }
  try {
    if (statSync(real).size > MAX_CITED_BYTES) return { ...base, status: 'unreadable', detail: `larger than ${MAX_CITED_BYTES} bytes` };
    const buf = readFileSync(real);
    const actual = sha256Hex(buf);
    return actual === ref.sha256
      ? { ...base, status: 'ok' }
      : { ...base, status: 'changed', actual_sha256: actual };
  } catch (error) {
    return { ...base, status: 'unreadable', detail: error.code ?? 'cannot read' };
  }
}
