// services/brand-engine/src/registry.js
//
// The Brand Profile Registry and the Framework registry: load, validate and
// cross-check the DATA in brand/ (knowledge is separate from code and is
// reviewed by path, see .github/CODEOWNERS), plus load a product profile from
// an arbitrary checkout path.
import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSchema } from './schema.js';
import { readJson } from './json.js';
import { checkPrinciple, checkProfile } from './rules.js';
import { compareSemver } from './semver.js';
import { resolveProfile } from './resolve.js';

const SCHEMAS_DIR = new URL('../../../schemas/', import.meta.url);

function loadSchema(name) {
  const read = readJson(fileURLToPath(new URL(name, SCHEMAS_DIR)));
  if (!read.ok) throw new Error(`cannot load schema ${name}: ${read.error}`);
  return compileSchema(read.value);
}

let compiled;
function schemas() {
  compiled ??= {
    profile: loadSchema('brand-profile.schema.json'),
    principle: loadSchema('brand-principle.schema.json'),
  };
  return compiled;
}

/** The repository's own brand/ directory (two levels up from this service). */
export function defaultBrandDir() {
  return fileURLToPath(new URL('../../../brand/', import.meta.url));
}

/** Schema + cross-field errors for one profile document. `location`: 'brain' | 'product'. */
export function validateProfileDoc(doc, { location }) {
  const errors = schemas().profile(doc);
  if (errors.length) return errors; // cross-field rules assume a well-formed shape
  return checkProfile(doc, { location });
}

export function validatePrincipleDoc(doc) {
  const errors = schemas().principle(doc);
  if (errors.length) return errors;
  return checkPrinciple(doc);
}

function listJson(dir, suffix) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(suffix)).sort();
  } catch {
    return null;
  }
}

/**
 * Load every principle and profile under `brandDir`. Never throws on bad
 * data: problems are returned in `errors` as {file, message} so a caller can
 * decide to fail closed. Files that are invalid are NOT admitted to the maps.
 */
export function loadBrandDir(brandDir = defaultBrandDir()) {
  const principles = new Map();
  const profiles = new Map();
  const errors = [];
  const warnings = [];

  const principleDir = join(brandDir, 'framework', 'principles');
  const profileDir = join(brandDir, 'profiles');

  const pFiles = listJson(principleDir, '.json');
  if (pFiles === null) errors.push({ file: principleDir, message: 'framework/principles directory is missing' });
  for (const file of pFiles ?? []) {
    const path = join(principleDir, file);
    const read = readJson(path, { followSymlinks: false });
    if (!read.ok) { errors.push({ file: path, message: read.error }); continue; }
    const problems = validatePrincipleDoc(read.value);
    if (!problems.length && file !== `${read.value.id}-${read.value.slug}.json`) {
      problems.push(`file name must be ${read.value.id}-${read.value.slug}.json`);
    }
    if (!problems.length && principles.has(read.value.id)) problems.push(`duplicate principle id ${read.value.id}`);
    if (problems.length) { for (const m of problems) errors.push({ file: path, message: m }); continue; }
    principles.set(read.value.id, read.value);
  }

  const fFiles = listJson(profileDir, '.profile.json');
  if (fFiles === null) errors.push({ file: profileDir, message: 'profiles directory is missing' });
  for (const file of fFiles ?? []) {
    const path = join(profileDir, file);
    const read = readJson(path, { followSymlinks: false });
    if (!read.ok) { errors.push({ file: path, message: read.error }); continue; }
    const problems = validateProfileDoc(read.value, { location: 'brain' });
    if (!problems.length && file !== `${read.value.id}.profile.json`) problems.push(`file name must be ${read.value.id}.profile.json`);
    if (!problems.length && profiles.has(read.value.id)) problems.push(`duplicate profile id ${read.value.id}`);
    if (problems.length) { for (const m of problems) errors.push({ file: path, message: m }); continue; }
    profiles.set(read.value.id, read.value);
  }

  const registry = { brandDir, principles, profiles, errors, warnings };

  // Cross-checks need the full set, so they run after loading.
  for (const profile of profiles.values()) {
    const { errors: ce, warnings: cw } = crossCheckProfile(profile, registry);
    for (const m of ce) errors.push({ file: join(profileDir, `${profile.id}.profile.json`), message: m });
    for (const m of cw) warnings.push({ file: join(profileDir, `${profile.id}.profile.json`), message: m });
    const r = resolveProfile(profile, registry);
    for (const m of r.errors) errors.push({ file: join(profileDir, `${profile.id}.profile.json`), message: `resolve: ${m}` });
    for (const m of r.warnings) warnings.push({ file: join(profileDir, `${profile.id}.profile.json`), message: `resolve: ${m}` });
  }
  return registry;
}

/** References from a profile into the framework must resolve. */
export function crossCheckProfile(profile, registry) {
  const errors = [];
  const warnings = [];
  const known = (id) => registry.principles.has(id);

  (profile.experience_standards ?? []).forEach((s, i) => {
    const p = registry.principles.get(s.principle);
    if (!p) { errors.push(`$.experience_standards[${i}]: unknown principle ${s.principle}`); return; }
    const c = compareSemver(s.principle_version, p.version);
    if (c > 0) errors.push(`$.experience_standards[${i}]: pins ${s.principle}@${s.principle_version}, newer than the framework's ${p.version}`);
    else if (c < 0) warnings.push(`$.experience_standards[${i}]: pins ${s.principle}@${s.principle_version}; the framework is at ${p.version}`);
  });
  (profile.behavioural_principles ?? []).forEach((b, i) => {
    if (b.principle && !known(b.principle)) errors.push(`$.behavioural_principles[${i}]: unknown principle ${b.principle}`);
  });
  (profile.domain_overrides ?? []).forEach((d, i) => {
    if (!known(d.principle)) errors.push(`$.domain_overrides[${i}]: unknown principle ${d.principle}`);
  });
  return { errors, warnings };
}

/**
 * Load a product profile from an arbitrary path (a product repository's own
 * brand/profile.json). Returns {profile, errors, warnings, resolved}. The
 * profile is NOT added to the registry: it belongs to the product repo, and so
 * does its visibility.
 */
export function loadProductProfile(path, registry) {
  const read = readJson(path);
  if (!read.ok) return { profile: null, resolved: null, errors: [`${basename(path)}: ${read.error}`], warnings: [] };
  const errors = validateProfileDoc(read.value, { location: 'product' });
  if (errors.length) return { profile: read.value, resolved: null, errors, warnings: [] };
  const cross = crossCheckProfile(read.value, registry);
  const r = resolveProfile(read.value, registry);
  return {
    profile: read.value,
    resolved: r.resolved,
    errors: [...cross.errors, ...r.errors],
    warnings: [...cross.warnings, ...r.warnings],
  };
}

/** Accept "id", "id@version" or a path to a profile file; returns {profile, errors, warnings, resolved, source}. */
export function lookupProfile(arg, registry) {
  if (arg.endsWith('.json') || arg.includes('/') || arg.includes('\\')) {
    return { ...loadProductProfile(arg, registry), source: 'file' };
  }
  const [id, version] = arg.split('@');
  const profile = registry.profiles.get(id);
  if (!profile) return { profile: null, resolved: null, errors: [`unknown profile ${id}`], warnings: [], source: 'registry' };
  if (version !== undefined && version !== profile.version) {
    return { profile: null, resolved: null, errors: [`profile ${id} is at ${profile.version}, not ${version}`], warnings: [], source: 'registry' };
  }
  const cross = crossCheckProfile(profile, registry);
  const r = resolveProfile(profile, registry);
  return {
    profile, resolved: r.resolved, source: 'registry',
    errors: [...cross.errors, ...r.errors], warnings: [...cross.warnings, ...r.warnings],
  };
}
