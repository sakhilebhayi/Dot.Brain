import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDrift, DriftUsageError, sha256Hex } from '../src/drift.js';
import { copyBrandDir, FIXTURE, profileDoc, readJsonFile, shipped, writeJson } from './_helpers.js';
import { loadBrandDir, loadProductProfile, lookupProfile } from '../src/registry.js';

const FIXTURE_PROFILE = join(FIXTURE, 'brand', 'profile.json');

test('the example product profile loads from an arbitrary path, extends a Brain profile, and resolves with its override', () => {
  const reg = shipped();
  const r = loadProductProfile(FIXTURE_PROFILE, reg);
  assert.deepEqual(r.errors, []);
  assert.equal(r.profile['x-fixture'], true);
  assert.deepEqual(r.resolved.chain, ['example-product@0.1.0', 'infodot@0.1.0', 'dot-ecosystem@0.1.0']);
  const b07 = r.resolved.experience_standards.find((s) => s.principle === 'BXP-07');
  assert.equal(b07.stance, 'adapted');
  assert.ok(r.resolved.overrides_applied.some((o) => o.field === 'experience_standards:BXP-07' && o.by === 'example-product@0.1.0'));
  // inherited non-negotiables survive three levels
  assert.ok(r.resolved.behavioural_principles.find((b) => b.id === 'accessibility-baseline').non_negotiable);
  assert.ok(r.resolved.language.claims_policy.forbidden.some((f) => f.id === 'no-invented-customer-counts'));
  assert.equal(r.resolved.effective_status, 'draft');
});

test('loading a product profile does not add it to the registry: it belongs to its own repository', () => {
  const reg = shipped();
  loadProductProfile(FIXTURE_PROFILE, reg);
  assert.equal(reg.profiles.has('example-product'), false);
  assert.equal(shipped().profiles.has('example-product'), false);
});

test('lookupProfile treats a path as a product profile and an id as a registry profile', () => {
  const reg = shipped();
  assert.equal(lookupProfile(FIXTURE_PROFILE, reg).source, 'file');
  assert.equal(lookupProfile('infodot', reg).source, 'registry');
});

test('a product profile must be kind product and must extend something that exists', () => {
  const reg = shipped();
  const dir = mkdtempSync(join(tmpdir(), 'be-product-'));
  const doc = readJsonFile(FIXTURE_PROFILE);

  writeJson(join(dir, 'a.json'), { ...doc, kind: 'brand' });
  assert.match(loadProductProfile(join(dir, 'a.json'), reg).errors.join('\n'), /must have kind "product"/);

  writeJson(join(dir, 'b.json'), { ...doc, extends: 'ghost@0.1.0' });
  assert.match(loadProductProfile(join(dir, 'b.json'), reg).errors.join('\n'), /unknown profile ghost/);

  writeJson(join(dir, 'c.json'), { ...doc, extends: 'infodot@0.0.9' });
  assert.match(loadProductProfile(join(dir, 'c.json'), reg).errors.join('\n'), /registry holds infodot@0\.1\.0/);

  const missing = loadProductProfile(join(dir, 'missing.json'), reg);
  assert.match(missing.errors.join('\n'), /cannot read: ENOENT/);

  writeFileSync(join(dir, 'd.json'), '{ not json');
  assert.match(loadProductProfile(join(dir, 'd.json'), reg).errors.join('\n'), /invalid JSON/);
});

test('a product profile may not claim ratification without a human approver', () => {
  const reg = shipped();
  const dir = mkdtempSync(join(tmpdir(), 'be-product-'));
  const doc = { ...readJsonFile(FIXTURE_PROFILE), status: 'ratified' };
  writeJson(join(dir, 'p.json'), doc);
  const errors = loadProductProfile(join(dir, 'p.json'), reg).errors.join('\n');
  assert.match(errors, /requires an approver/);
  assert.match(errors, /requires ratified_at/);
});

test('a product profile with an extra field or a copied token blob is rejected by the schema', () => {
  const reg = shipped();
  const dir = mkdtempSync(join(tmpdir(), 'be-product-'));
  writeJson(join(dir, 'p.json'), { ...readJsonFile(FIXTURE_PROFILE), tokens: { primary: '#123456' } });
  assert.match(loadProductProfile(join(dir, 'p.json'), reg).errors.join('\n'), /\$\.tokens: is not an allowed property/);
});

test('loading Brain data: bad files are reported and not admitted; a product kind, a private classification or a wrong file name is refused', () => {
  const dir = copyBrandDir();
  const bad = profileDoc('blupin');
  bad.id = 'blupin-copy';
  writeJson(join(dir, 'profiles', 'wrong-name.profile.json'), bad);
  const prod = { ...readJsonFile(FIXTURE_PROFILE) };
  writeJson(join(dir, 'profiles', 'example-product.profile.json'), prod);
  const priv = profileDoc('blupin');
  priv.id = 'secretco';
  priv.classification = 'restricted';
  writeJson(join(dir, 'profiles', 'secretco.profile.json'), priv);
  writeFileSync(join(dir, 'profiles', 'broken.profile.json'), '{');

  const reg = loadBrandDir(dir);
  const text = reg.errors.map((e) => `${e.file}: ${e.message}`).join('\n');
  assert.match(text, /wrong-name\.profile\.json: file name must be blupin-copy\.profile\.json/);
  assert.match(text, /example-product\.profile\.json: \$\.kind: product profiles belong in their product repository/);
  assert.match(text, /secretco\.profile\.json: \$\.classification: Dot\.Brain is public/);
  assert.match(text, /broken\.profile\.json: invalid JSON/);
  assert.deepEqual([...reg.profiles.keys()].sort(), ['blupin', 'dot-ecosystem', 'infodot']);
});

test('a symlinked data file is not followed', () => {
  const dir = copyBrandDir();
  symlinkSync(join(dir, 'profiles', 'blupin.profile.json'), join(dir, 'profiles', 'link.profile.json'));
  const reg = loadBrandDir(dir);
  assert.match(reg.errors.map((e) => e.message).join('\n'), /not a regular file/);
});

test('a missing framework directory is reported, and a principle with the wrong file name is refused', () => {
  const dir = copyBrandDir();
  rmSync(join(dir, 'framework'), { recursive: true });
  assert.match(loadBrandDir(dir).errors.map((e) => e.message).join('\n'), /framework\/principles directory is missing/);

  const dir2 = copyBrandDir();
  const p = readJsonFile(join(dir2, 'framework', 'principles', 'BXP-01-emotional-positioning.json'));
  writeJson(join(dir2, 'framework', 'principles', 'BXP-01-other.json'), p);
  assert.match(loadBrandDir(dir2).errors.map((e) => e.message).join('\n'), /file name must be BXP-01-emotional-positioning\.json|duplicate principle id BXP-01/);
});

// ---------------------------------------------------------------- drift

function checkout(files) {
  const dir = mkdtempSync(join(tmpdir(), 'be-checkout-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}
const hash = (s) => createHash('sha256').update(s).digest('hex');
const profileCiting = (refs) => ({ visual_direction: { source_refs: refs.map(([repo, path, content]) => ({ repo, path, commit: 'a'.repeat(40), sha256: hash(content) })) } });

test('sha256Hex is the standard SHA-256 (known vector)', () => {
  assert.equal(sha256Hex(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('drift: unchanged files are ok', () => {
  const dir = checkout({ 'PRODUCT.md': 'one', 'docs/DESIGN.md': 'two' });
  const r = checkDrift(profileCiting([['o/r', 'PRODUCT.md', 'one'], ['o/r', 'docs/DESIGN.md', 'two']]), { root: dir });
  assert.equal(r.ok, true);
  assert.equal(r.drifted, 0);
  assert.deepEqual(r.checked.map((c) => c.status), ['ok', 'ok']);
});

test('drift: a changed file reports both hashes; a missing file is missing; the rest stay ok', () => {
  const dir = checkout({ 'PRODUCT.md': 'one but edited', 'DESIGN.md': 'two' });
  const r = checkDrift(profileCiting([['o/r', 'PRODUCT.md', 'one'], ['o/r', 'DESIGN.md', 'two'], ['o/r', 'gone.md', 'x']]), { root: dir });
  assert.equal(r.ok, false);
  assert.equal(r.drifted, 2);
  const by = Object.fromEntries(r.checked.map((c) => [c.path, c]));
  assert.equal(by['PRODUCT.md'].status, 'changed');
  assert.equal(by['PRODUCT.md'].recorded_sha256, hash('one'));
  assert.equal(by['PRODUCT.md'].actual_sha256, hash('one but edited'));
  assert.equal(by['DESIGN.md'].status, 'ok');
  assert.equal(by['gone.md'].status, 'missing');
});

test('drift: a directory where a file was cited is unreadable, not ok', () => {
  const dir = checkout({ 'PRODUCT.md/inner.txt': 'x' });
  const r = checkDrift(profileCiting([['o/r', 'PRODUCT.md', 'x']]), { root: dir });
  assert.equal(r.checked[0].status, 'unreadable');
});

test('drift: a symlink that leaves the checkout is refused; one that stays inside is followed', () => {
  const outside = checkout({ 'secret.txt': 'top secret' });
  const dir = checkout({ 'real.md': 'real' });
  symlinkSync(join(outside, 'secret.txt'), join(dir, 'escape.md'));
  symlinkSync(join(dir, 'real.md'), join(dir, 'inside.md'));
  const r = checkDrift(profileCiting([['o/r', 'escape.md', 'top secret'], ['o/r', 'inside.md', 'real']]), { root: dir });
  const by = Object.fromEntries(r.checked.map((c) => [c.path, c]));
  assert.equal(by['escape.md'].status, 'unreadable');
  assert.match(by['escape.md'].detail, /outside --root/);
  assert.equal(by['inside.md'].status, 'ok');
});

test('drift: a path that tries to climb out is never read, even if the profile somehow carried it', () => {
  const outside = checkout({ 'x.md': 'x' });
  const dir = join(outside, 'sub');
  mkdirSync(dir);
  const r = checkDrift(profileCiting([['o/r', '../x.md', 'x']]), { root: dir });
  assert.equal(r.checked[0].status, 'unreadable');
  assert.match(r.checked[0].detail, /unsafe path/);
});

test('drift: refs in several repositories need --repo; only that repository is checked', () => {
  const dir = checkout({ 'a.md': 'a' });
  const profile = profileCiting([['o/one', 'a.md', 'a'], ['o/two', 'b.md', 'b']]);
  assert.throws(() => checkDrift(profile, { root: dir }), DriftUsageError);
  const r = checkDrift(profile, { root: dir, repo: 'o/one' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.skipped, [{ repo: 'o/two', path: 'b.md' }]);
  assert.throws(() => checkDrift(profile, { root: dir, repo: 'o/three' }), /cites no files in o\/three/);
});

test('drift: a bad --root is a usage error; a profile citing nothing has nothing to drift', () => {
  assert.throws(() => checkDrift(profileCiting([['o/r', 'a.md', 'a']]), { root: '/nonexistent/root/xyz' }), DriftUsageError);
  const dir = checkout({});
  const r = checkDrift(profileCiting([]), { root: dir });
  assert.equal(r.ok, true);
  assert.equal(r.checked.length, 0);
});

test('the example product\'s own cited files match their recorded hashes; editing one is detected', () => {
  const profile = readJsonFile(FIXTURE_PROFILE);
  assert.equal(checkDrift(profile, { root: FIXTURE }).ok, true);

  const copy = mkdtempSync(join(tmpdir(), 'be-fixture-'));
  cpSync(FIXTURE, copy, { recursive: true });
  writeFileSync(join(copy, 'DESIGN.md'), 'edited\n');
  const r = checkDrift(profile, { root: copy });
  assert.equal(r.ok, false);
  assert.equal(r.checked.find((c) => c.path === 'DESIGN.md').status, 'changed');
});
