// services/platform-collector/test/registry.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, loadManifests, REQUIRED_KEYS, DEFAULTS } from '../src/registry.js';

const VALID = {
  platform: 'dot-mines',
  health_url: 'https://mines.infodot.co.za/guardian/health',
  token_env: 'DOT_MINES_GUARDIAN_TOKEN',
};

test('REQUIRED_KEYS lists platform, health_url, and token_env', () => {
  assert.deepEqual(REQUIRED_KEYS, ['platform', 'health_url', 'token_env']);
});

test('validateManifest fills in the default timeout', () => {
  assert.equal(validateManifest(VALID).timeout_ms, DEFAULTS.timeout_ms);
  assert.equal(DEFAULTS.timeout_ms, 15000);
});

test('validateManifest preserves an explicit timeout_ms', () => {
  assert.equal(validateManifest({ ...VALID, timeout_ms: 5000 }).timeout_ms, 5000);
});

test('validateManifest throws listing every missing required key', () => {
  assert.throws(() => validateManifest({ platform: 'dot-mines' }), /health_url, token_env/);
});

test('validateManifest rejects a required key that is present but not a non-empty string', () => {
  for (const platform of [{ x: 1 }, 42, null, '']) {
    assert.throws(
      () => validateManifest({ ...VALID, platform }),
      /missing required key\(s\): platform/,
      `expected ${JSON.stringify(platform)} to be rejected`,
    );
  }
});

test('validateManifest rejects a manifest that is not a JSON object', () => {
  for (const raw of [null, [], 'x', 7]) {
    assert.throws(() => validateManifest(raw), /must be a JSON object/);
  }
});

test('validateManifest rejects an unrecognized key', () => {
  assert.throws(() => validateManifest({ ...VALID, Timeout_Ms: 1 }), /unrecognized key\(s\): Timeout_Ms/);
});

test('validateManifest rejects a platform id that is unsafe or too long', () => {
  for (const platform of ['has space', 'a|b', '-lead', 'x'.repeat(65), 'a\nb']) {
    assert.throws(
      () => validateManifest({ ...VALID, platform }),
      /platform must match/,
      `expected ${JSON.stringify(platform)} to be rejected`,
    );
  }
});

test('validateManifest rejects a non-https health_url', () => {
  assert.throws(
    () => validateManifest({ ...VALID, health_url: 'http://mines.infodot.co.za/guardian/health' }),
    /health_url must use https/,
  );
});

test('validateManifest rejects a timeout_ms that is not a positive finite number', () => {
  for (const timeout_ms of ['abc', -1, 0, null, Infinity]) {
    assert.throws(
      () => validateManifest({ ...VALID, timeout_ms }),
      /timeout_ms must be a positive number/,
      `expected ${JSON.stringify(timeout_ms)} to be rejected`,
    );
  }
});

function fakeFs(files) {
  return {
    readDirImpl: () => Object.keys(files),
    readFileImpl: (path) => files[path.split('/').pop()],
  };
}

test('loadManifests parses and validates every .json file and ignores the rest', () => {
  const { readDirImpl, readFileImpl } = fakeFs({
    'dot-mines.json': JSON.stringify(VALID),
    'blupin.json': JSON.stringify({ ...VALID, platform: 'blupin', token_env: 'DOT_MEMORY_TOKEN' }),
    'README.md': 'not a manifest',
  });
  const manifests = loadManifests('dir', readDirImpl, readFileImpl);
  assert.deepEqual(manifests.map((m) => m.platform), ['dot-mines', 'blupin']);
});

test('loadManifests names the file when a manifest is invalid', () => {
  const { readDirImpl, readFileImpl } = fakeFs({ 'broken.json': JSON.stringify({ platform: 'x' }) });
  assert.throws(() => loadManifests('dir', readDirImpl, readFileImpl), /broken\.json/);
});

test('loadManifests names the file when a manifest is not valid JSON', () => {
  const { readDirImpl, readFileImpl } = fakeFs({ 'broken.json': '{not json' });
  assert.throws(() => loadManifests('dir', readDirImpl, readFileImpl), /broken\.json/);
});

test('loadManifests rejects two manifests that declare the same platform', () => {
  const { readDirImpl, readFileImpl } = fakeFs({
    'a.json': JSON.stringify(VALID),
    'b.json': JSON.stringify(VALID),
  });
  assert.throws(
    () => loadManifests('dir', readDirImpl, readFileImpl),
    /b\.json: platform "dot-mines" is already declared by a\.json/,
  );
});

test('loadManifests returns an empty list for a directory with no manifests', () => {
  const { readDirImpl, readFileImpl } = fakeFs({ 'README.md': 'x' });
  assert.deepEqual(loadManifests('dir', readDirImpl, readFileImpl), []);
});
