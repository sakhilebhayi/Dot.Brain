// services/brand-engine/src/semver.js
const RE = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseSemver(v) {
  const m = RE.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** -1, 0, 1; throws on a non-semver (callers validate first). */
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) throw new Error(`not a semver: ${pa ? b : a}`);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/** "id@1.2.3" -> {id, version} or null */
export function parseIdVersion(ref) {
  const i = typeof ref === 'string' ? ref.lastIndexOf('@') : -1;
  if (i < 1) return null;
  const id = ref.slice(0, i);
  const version = ref.slice(i + 1);
  return parseSemver(version) ? { id, version } : null;
}
