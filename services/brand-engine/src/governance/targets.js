// services/brand-engine/src/governance/targets.js
//
// The CURRENT state of the things a proposal can change: a profile, a
// principle, the BXQS rubric, the doctrine. Read-only. A proposal records the
// version and sha256 it was written against; lint compares that with what is
// on disk now, so a proposal cannot be applied over a change it never saw.
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readJson } from '../json.js';
import { compareSemver, parseSemver } from '../semver.js';
import { canonicalHash, sha256Hex } from '../score/util.js';

export const TARGET_KINDS = ['profile', 'principle', 'rubric', 'doctrine'];
export const DOCTRINE_ID = 'brain.brand_experience';
const DOCTRINE_FILE = 'brain.brand_experience.md';

/** The repository root: the parent of the brand/ directory. */
export const repoRootOf = (brandDir) => dirname(resolve(brandDir));

/** Version and status from the YAML front matter of a Markdown document. */
export function frontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-z-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

// The doctrine's front matter says `proposed` or `active`; only `active` is a ratified state.
const doctrineStatus = (s) => (s === 'active' ? 'ratified' : s === 'proposed' ? 'proposed' : 'draft');

function readDoctrine(brandDir) {
  const file = join(repoRootOf(brandDir), DOCTRINE_FILE);
  try {
    if (!lstatSync(file).isFile()) return null;
    const text = readFileSync(file, 'utf8');
    const fm = frontMatter(text);
    if (!parseSemver(fm.version ?? '')) return null;
    return { version: fm.version, status: doctrineStatus(fm.status), sha256: sha256Hex(text), file: DOCTRINE_FILE };
  } catch {
    return null;
  }
}

function principleFile(brandDir, id) {
  const dir = join(brandDir, 'framework', 'principles');
  try {
    const name = readdirSync(dir).sort().find((f) => f.startsWith(`${id}-`) && f.endsWith('.json'));
    return name ? join(dir, name) : null;
  } catch {
    return null;
  }
}

function releasedRubrics(brandDir) {
  const read = readJson(join(brandDir, 'rubrics', 'released.json'), { followSymlinks: false });
  return read.ok && read.value?.released && typeof read.value.released === 'object' ? read.value.released : {};
}

/**
 * Current state of a target, or {exists:false}. Never throws.
 * { exists, version, status, sha256, engagement_related, versions? (rubric), file }
 */
export function readTarget(brandDir, kind, id) {
  if (kind === 'profile' || kind === 'principle') {
    const path = kind === 'profile' ? join(brandDir, 'profiles', `${id}.profile.json`) : principleFile(brandDir, id);
    if (!path || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) return { exists: false };
    const read = readJson(path, { followSymlinks: false });
    if (!read.ok || typeof read.value?.version !== 'string') return { exists: false };
    return {
      exists: true, version: read.value.version, status: read.value.status, sha256: canonicalHash(read.value),
      engagement_related: kind === 'principle' ? read.value.engagement_related === true : false, file: path,
    };
  }
  if (kind === 'rubric') {
    const released = releasedRubrics(brandDir)[id];
    if (!released) return { exists: false };
    const versions = Object.keys(released).filter((v) => parseSemver(v)).sort(compareSemver);
    if (!versions.length) return { exists: false };
    const current = versions[versions.length - 1];
    const ratified = existsSync(join(brandDir, 'rubrics', `${id}-${current}.ratification.json`));
    return { exists: true, version: current, versions, status: ratified ? 'ratified' : 'proposed', sha256: released[current].sha256, engagement_related: false, file: `rubrics/${id}-${current}.json` };
  }
  if (kind === 'doctrine') {
    if (id !== DOCTRINE_ID) return { exists: false };
    const d = readDoctrine(brandDir);
    return d ? { exists: true, ...d, engagement_related: false } : { exists: false };
  }
  return { exists: false };
}

/**
 * Every governed document on disk, keyed like a changelog entry's `doc`:
 * profile:<id>, principle:<BXP-NN>, doctrine:<id>. The rubric has its own
 * immutability mechanism (released.json and the ratification record).
 */
export function listGovernedDocs(brandDir) {
  const docs = new Map();
  const scan = (dir, suffix, kind) => {
    let names = [];
    try { names = readdirSync(dir).filter((f) => f.endsWith(suffix)).sort(); } catch { return; }
    for (const name of names) {
      const read = readJson(join(dir, name), { followSymlinks: false });
      const v = read.ok ? read.value : null;
      if (!v || typeof v.id !== 'string' || typeof v.version !== 'string' || typeof v.status !== 'string') continue;
      docs.set(`${kind}:${v.id}`, { version: v.version, status: v.status, sha256: canonicalHash(v), file: join(dir, name) });
    }
  };
  scan(join(brandDir, 'profiles'), '.profile.json', 'profile');
  scan(join(brandDir, 'framework', 'principles'), '.json', 'principle');
  const doctrine = readDoctrine(brandDir);
  if (doctrine) docs.set(`doctrine:${DOCTRINE_ID}`, doctrine);
  return docs;
}
