import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadManifests, validateManifest } from '../src/registry.js';

const VALID = {
  platform: 'dot-mines',
  health_url: 'https://mines.test/guardian/health',
  token_env: 'DOT_MINES_GUARDIAN_TOKEN',
  repo: 'sakhilebhayi/Dot.Mines',
  default_branch: 'main',
  deploy: { workflow: 'deploy.yml' },
  autonomy_level: 2,
};

test('validateManifest fills defaults', () => {
  const manifest = validateManifest({ ...VALID });
  assert.equal(manifest.poll_interval_s, 300);
  assert.equal(manifest.max_fix_attempts, 2);
  assert.equal(manifest.max_deploys_per_6h, 3);
  assert.deepEqual(manifest.protected_areas, []);
  assert.equal(manifest.verification.polls, 5);
  assert.deepEqual(manifest.deploy.confirm_inputs, {});
});

test('validateManifest rejects missing keys', () => {
  for (const key of ['platform', 'health_url', 'token_env', 'repo', 'default_branch', 'deploy', 'autonomy_level']) {
    const raw = { ...VALID };
    delete raw[key];
    assert.throws(() => validateManifest(raw), new RegExp(key));
  }
});

test('validateManifest rejects out-of-range autonomy level', () => {
  assert.throws(() => validateManifest({ ...VALID, autonomy_level: 0 }), /autonomy_level/);
  assert.throws(() => validateManifest({ ...VALID, autonomy_level: 5 }), /autonomy_level/);
  assert.throws(() => validateManifest({ ...VALID, autonomy_level: 2.5 }), /autonomy_level/);
});

test('loadManifests reads every json file in the directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guardian-manifests-'));
  writeFileSync(join(dir, 'dot-mines.json'), JSON.stringify(VALID));
  writeFileSync(join(dir, 'dot-farms.json'), JSON.stringify({ ...VALID, platform: 'dot-farms' }));

  const manifests = loadManifests(dir);
  assert.deepEqual(manifests.map((manifest) => manifest.platform).sort(), ['dot-farms', 'dot-mines']);
});

test('loadManifests names the offending file on validation failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guardian-manifests-'));
  writeFileSync(join(dir, 'broken.json'), JSON.stringify({ platform: 'x' }));
  assert.throws(() => loadManifests(dir), /broken\.json/);
});

test('the committed dot-mines manifest is valid', () => {
  const manifests = loadManifests(new URL('../../../platforms/guardian', import.meta.url).pathname);
  const mines = manifests.find((manifest) => manifest.platform === 'dot-mines');
  assert.ok(mines, 'platforms/guardian/dot-mines.json must exist');
  assert.equal(mines.deploy.workflow, 'deploy.yml');
  assert.equal(mines.deploy.confirm_inputs.confirm, 'deploy');
  assert.ok(mines.autonomy_level <= 2, 'dot-mines must stay at recommend-level autonomy until scenario testing signs off (plan §15)');
});
