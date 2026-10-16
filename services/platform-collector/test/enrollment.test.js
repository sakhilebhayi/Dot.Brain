// services/platform-collector/test/enrollment.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadManifests } from '../src/registry.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MANIFEST_DIR = `${ROOT}platforms/collector`;
const WORKFLOW = readFileSync(`${ROOT}.github/workflows/platform-collector.yml`, 'utf8');
const TESTS_WORKFLOW = readFileSync(`${ROOT}.github/workflows/tests.yml`, 'utf8');
const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

test('day-one enrollment is dot-mines and blupin, and every committed manifest is valid', () => {
  const manifests = loadManifests(MANIFEST_DIR);
  assert.deepEqual(manifests.map((m) => m.platform).sort(), ['blupin', 'dot-mines']);
  const mines = manifests.find((m) => m.platform === 'dot-mines');
  assert.equal(mines.health_url, 'https://mines.infodot.co.za/guardian/health');
  assert.equal(mines.token_env, 'DOT_MINES_GUARDIAN_TOKEN');
  const blupin = manifests.find((m) => m.platform === 'blupin');
  assert.equal(blupin.health_url, 'https://memory.infodot.co.za/api/guardian/blupin');
  assert.equal(blupin.token_env, 'DOT_MEMORY_TOKEN');
});

test('the workflow passes every enrolled manifest token_env to the job', () => {
  for (const manifest of loadManifests(MANIFEST_DIR)) {
    assert.ok(
      WORKFLOW.includes(`${manifest.token_env}: \${{ secrets.${manifest.token_env} }}`),
      `${manifest.token_env} (${manifest.platform}) is enrolled but never passed to the workflow`,
    );
  }
});

test('the workflow runs hourly at minute 17, never overlaps itself, and cannot write to the repo', () => {
  assert.ok(WORKFLOW.includes("cron: '17 * * * *'"));
  assert.ok(WORKFLOW.includes('cancel-in-progress: false'));
  assert.ok(WORKFLOW.includes('contents: read'));
});

test('the CI matrix and coverage check both include this service', () => {
  assert.ok(TESTS_WORKFLOW.includes('          - platform-collector\n'), 'missing from the matrix');
  const covered = TESTS_WORKFLOW.match(/covered="([^"]*)"/)[1].split(/\s+/);
  assert.ok(covered.includes('platform-collector'), 'missing from the covered list');
});

test('a dry run against the committed manifests makes no network call when no tokens are set', () => {
  const result = spawnSync(process.execPath, [CLI, 'collect', '--manifest-dir', MANIFEST_DIR, '--dry-run'], {
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dot-mines/);
  assert.match(result.stdout, /blupin/);
  assert.match(result.stdout, /config/);
});

test('a real run without Dot.Memory configured exits 1 before any request', () => {
  const result = spawnSync(process.execPath, [CLI, 'collect', '--manifest-dir', MANIFEST_DIR], {
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DOT_MEMORY_URL/);
});
