import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, loadManifests, DEFAULTS, REQUIRED_KEYS } from '../src/registry.js';

test('REQUIRED_KEYS lists platform, signals_url, and token_env', () => {
  assert.deepEqual(REQUIRED_KEYS, ['platform', 'signals_url', 'token_env']);
});

test('validateManifest fills in defaults for optional keys', () => {
  const result = validateManifest({
    platform: 'dot-billing',
    signals_url: 'https://billing.dot/revenue/signals',
    token_env: 'DOT_BILLING_REVENUE_TOKEN',
  });
  assert.equal(result.poll_interval_s, 3600);
  assert.equal(result.timeout_ms, 15000);
  assert.equal(result.classification_ceiling, 'restricted');
});

test('validateManifest preserves explicit overrides of defaults', () => {
  const result = validateManifest({
    platform: 'dot-billing',
    signals_url: 'https://billing.dot/revenue/signals',
    token_env: 'DOT_BILLING_REVENUE_TOKEN',
    poll_interval_s: 900,
  });
  assert.equal(result.poll_interval_s, 900);
});

test('validateManifest throws listing every missing required key', () => {
  assert.throws(
    () => validateManifest({ platform: 'dot-billing' }),
    /signals_url, token_env/,
  );
});

test('validateManifest throws when given an empty object', () => {
  assert.throws(
    () => validateManifest({}),
    /platform, signals_url, token_env/,
  );
});

test('validateManifest throws on an unrecognized classification_ceiling', () => {
  assert.throws(
    () => validateManifest({
      platform: 'dot-billing',
      signals_url: 'https://billing.dot/revenue/signals',
      token_env: 'DOT_BILLING_REVENUE_TOKEN',
      classification_ceiling: 'internal',
    }),
    /classification_ceiling must be one of/,
  );
});

test('validateManifest throws when a required key is present but not a string', () => {
  assert.throws(
    () => validateManifest({
      platform: { tenant: 'dot-billing' },
      signals_url: 'https://billing.dot/revenue/signals',
      token_env: 'DOT_BILLING_REVENUE_TOKEN',
    }),
    /manifest missing required key\(s\): platform/,
  );
});

test('validateManifest throws on an unrecognized manifest key', () => {
  assert.throws(
    () => validateManifest({
      platform: 'dot-billing',
      signals_url: 'https://billing.dot/revenue/signals',
      token_env: 'DOT_BILLING_REVENUE_TOKEN',
      Classification_Ceiling: 'sensitive',
    }),
    /manifest has unrecognized key\(s\): Classification_Ceiling/,
  );
});

test('validateManifest throws on a non-positive-number timeout_ms', () => {
  for (const timeout_ms of ['abc', -1, 0, null]) {
    assert.throws(
      () => validateManifest({
        platform: 'dot-billing',
        signals_url: 'https://billing.dot/revenue/signals',
        token_env: 'DOT_BILLING_REVENUE_TOKEN',
        timeout_ms,
      }),
      /timeout_ms must be a positive number/,
      `expected ${JSON.stringify(timeout_ms)} to be rejected`,
    );
  }
});

test('validateManifest throws on a non-positive-number poll_interval_s', () => {
  assert.throws(
    () => validateManifest({
      platform: 'dot-billing',
      signals_url: 'https://billing.dot/revenue/signals',
      token_env: 'DOT_BILLING_REVENUE_TOKEN',
      poll_interval_s: -900,
    }),
    /poll_interval_s must be a positive number/,
  );
});

test('loadManifests parses and validates every .json file in a directory', () => {
  const readDirImpl = () => ['dot-billing.json', 'dot-analytics.json', 'notes.txt'];
  const files = {
    'dir/dot-billing.json': JSON.stringify({
      platform: 'dot-billing',
      signals_url: 'https://billing.dot/revenue/signals',
      token_env: 'DOT_BILLING_REVENUE_TOKEN',
    }),
    'dir/dot-analytics.json': JSON.stringify({
      platform: 'dot-analytics',
      signals_url: 'https://analytics.dot/revenue/signals',
      token_env: 'DOT_ANALYTICS_REVENUE_TOKEN',
    }),
  };
  const readFileImpl = (path) => files[path];
  const manifests = loadManifests('dir', readDirImpl, readFileImpl);
  assert.equal(manifests.length, 2);
  assert.equal(manifests[0].platform, 'dot-billing');
  assert.equal(manifests[1].platform, 'dot-analytics');
});

test('loadManifests ignores non-.json files in the directory', () => {
  const readDirImpl = () => ['dot-billing.json', 'README.md'];
  const files = {
    'dir/dot-billing.json': JSON.stringify({
      platform: 'dot-billing',
      signals_url: 'https://billing.dot/revenue/signals',
      token_env: 'DOT_BILLING_REVENUE_TOKEN',
    }),
  };
  const readFileImpl = (path) => files[path];
  const manifests = loadManifests('dir', readDirImpl, readFileImpl);
  assert.equal(manifests.length, 1);
});

test('loadManifests includes the filename when a manifest is invalid', () => {
  const readDirImpl = () => ['broken.json'];
  const readFileImpl = () => JSON.stringify({ platform: 'dot-broken' });
  assert.throws(
    () => loadManifests('dir', readDirImpl, readFileImpl),
    /broken\.json/,
  );
});

test('loadManifests includes the filename when a manifest is not valid JSON', () => {
  const readDirImpl = () => ['broken.json'];
  const readFileImpl = () => '{not valid json';
  assert.throws(
    () => loadManifests('dir', readDirImpl, readFileImpl),
    /broken\.json/,
  );
});
