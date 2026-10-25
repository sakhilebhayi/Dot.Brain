// services/brand-engine/src/analyze/git.js
//
// The commit and repository of a checkout, read from the files in .git
// directly. The engine does not run git, and it never emits a remote URL
// (which can carry a token): only "owner/name" is extracted from it.
//
// Handles a normal checkout, a worktree or submodule (".git" is a file with a
// "gitdir:" pointer), a detached HEAD, a branch ref and packed-refs. Only
// fixed file names inside the git directory are read, the ref name is
// validated before it is joined to a path, and every read is size-bounded.
import { lstatSync, openSync, closeSync, readSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

const MAX_GIT_FILE = 256 * 1024;
const SHA1 = /^[0-9a-f]{40}$/;
const REF_NAME = /^refs\/[A-Za-z0-9._\-/]{1,200}$/;

function readSmall(path) {
  let fd;
  try {
    const st = lstatSync(path);
    if (!st.isFile() || st.size > MAX_GIT_FILE) return null;
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(st.size);
    readSync(fd, buf, 0, st.size, 0);
    return buf.toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/** Locate the git directory and the common directory (where refs and config live). */
function locate(root) {
  const dotgit = join(root, '.git');
  let st;
  try { st = lstatSync(dotgit); } catch { return null; }
  let gitdir = null;
  if (st.isDirectory()) gitdir = dotgit;
  else if (st.isFile()) {
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(readSmall(dotgit) ?? '');
    if (m) gitdir = isAbsolute(m[1]) ? m[1] : resolve(root, m[1]);
  }
  if (!gitdir || !isDir(gitdir)) return null;
  let common = gitdir;
  const c = readSmall(join(gitdir, 'commondir'));
  if (c) {
    const candidate = isAbsolute(c.trim()) ? c.trim() : resolve(gitdir, c.trim());
    if (isDir(candidate)) common = candidate;
  }
  return { gitdir, common };
}

function resolveRef(ref, dirs) {
  if (!REF_NAME.test(ref) || ref.split('/').includes('..')) return null;
  for (const dir of dirs) {
    const v = readSmall(join(dir, ...ref.split('/')));
    if (v && SHA1.test(v.trim())) return v.trim();
  }
  for (const dir of dirs) {
    const packed = readSmall(join(dir, 'packed-refs'));
    if (!packed) continue;
    for (const line of packed.split('\n')) {
      const m = /^([0-9a-f]{40}) (\S+)$/.exec(line.trim());
      if (m && m[2] === ref) return m[1];
    }
  }
  return null;
}

/** "owner/name" from an origin URL, or null. The URL itself is never returned. */
export function repoFromRemote(url) {
  const m = /github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(String(url).trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * readGitInfo(root) -> { commit: 40 hex | null, repo: "owner/name" | null, source: "git" | "none" }
 * Looks at <root>/.git only, never at a parent directory.
 */
export function readGitInfo(root) {
  const loc = locate(root);
  if (!loc) return { commit: null, repo: null, source: 'none' };
  let commit = null;
  const head = (readSmall(join(loc.gitdir, 'HEAD')) ?? '').trim();
  if (SHA1.test(head)) commit = head;
  else {
    const m = /^ref:\s*(\S+)$/.exec(head);
    if (m) commit = resolveRef(m[1], loc.gitdir === loc.common ? [loc.gitdir] : [loc.gitdir, loc.common]);
  }
  let repo = null;
  const config = readSmall(join(loc.common, 'config'));
  if (config) {
    let inOrigin = false;
    for (const raw of config.split('\n')) {
      const line = raw.trim();
      const section = /^\[(.+)\]$/.exec(line);
      if (section) { inOrigin = /^remote\s+"origin"$/.test(section[1]); continue; }
      const url = inOrigin && /^url\s*=\s*(.+)$/.exec(line);
      if (url) { repo = repoFromRemote(url[1]); break; }
    }
  }
  return { commit, repo, source: commit ? 'git' : 'none' };
}
