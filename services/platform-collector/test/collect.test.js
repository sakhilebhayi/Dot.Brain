// services/platform-collector/test/collect.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collect, formatTable } from '../src/collect.js';

const MANIFESTS = [
  { platform: 'alpha', health_url: 'https://a.test/health', token_env: 'A_TOKEN', timeout_ms: 1000 },
  { platform: 'beta', health_url: 'https://b.test/health', token_env: 'B_TOKEN', timeout_ms: 1000 },
];
const ENV = { A_TOKEN: 'a', B_TOKEN: 'b' };
const CFG = { enabled: true, url: 'https://memory.test', token: 'tok' };
const NOW = () => new Date('2026-10-16T19:17:42.000Z');
const noSleep = async () => {};

const healthy = () => ({ ok: true, status: 200, json: async () => ({ status: 'healthy', checks: {} }) });
const httpStatus = (status) => () => ({ ok: false, status });

// Routes platform URLs to handlers and Memory writes to a recorder.
function world({ platforms, memoryStatus = () => 201 }) {
  const writes = [];
  let memoryCalls = 0;
  const fetchImpl = async (url, options = {}) => {
    const u = String(url);
    if (u.endsWith('/api/intelligence/events')) {
      memoryCalls += 1;
      const record = JSON.parse(options.body);
      writes.push(record);
      const status = memoryStatus(record);
      return { ok: status >= 200 && status < 300, status, json: async () => ({}) };
    }
    const handler = platforms[u];
    if (!handler) throw new Error(`unexpected fetch ${u}`);
    return handler();
  };
  return { fetchImpl, writes, memoryCalls: () => memoryCalls };
}

const URLS = { a: 'https://a.test/health', b: 'https://b.test/health' };

test('every platform is fetched and recorded; exit 0', async () => {
  const w = world({ platforms: { [URLS.a]: healthy, [URLS.b]: healthy } });
  const { rows, exitCode } = await collect({ manifests: MANIFESTS, cfg: CFG, fetchImpl: w.fetchImpl, env: ENV, now: NOW, sleep: noSleep });
  assert.equal(exitCode, 0);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.recorded === true));
  assert.deepEqual(w.writes.map((r) => r.subject_id).sort(), ['alpha', 'beta']);
});

test('a down platform is recorded as data and keeps the run green', async () => {
  const w = world({ platforms: { [URLS.a]: healthy, [URLS.b]: httpStatus(503) } });
  const { rows, exitCode } = await collect({ manifests: MANIFESTS, cfg: CFG, fetchImpl: w.fetchImpl, env: ENV, now: NOW, sleep: noSleep });
  assert.equal(exitCode, 0);
  const beta = w.writes.find((r) => r.subject_id === 'beta');
  assert.equal(beta.signature, 'failure:maintenance');
  assert.equal(rows.find((row) => row.manifest.platform === 'beta').recorded, true);
});

test('an unset token is recorded as a config failure, not skipped', async () => {
  const w = world({ platforms: { [URLS.a]: healthy, [URLS.b]: healthy } });
  const { exitCode } = await collect({ manifests: MANIFESTS, cfg: CFG, fetchImpl: w.fetchImpl, env: { A_TOKEN: 'a' }, now: NOW, sleep: noSleep });
  assert.equal(exitCode, 0);
  assert.equal(w.writes.find((r) => r.subject_id === 'beta').signature, 'failure:config');
});

test('one platform failing to record turns the run red but the others are still recorded', async () => {
  const w = world({
    platforms: { [URLS.a]: healthy, [URLS.b]: healthy },
    memoryStatus: (record) => (record.subject_id === 'beta' ? 500 : 201),
  });
  const { rows, exitCode } = await collect({ manifests: MANIFESTS, cfg: CFG, fetchImpl: w.fetchImpl, env: ENV, now: NOW, sleep: noSleep });
  assert.equal(exitCode, 1);
  assert.equal(rows.find((row) => row.manifest.platform === 'alpha').recorded, true);
  const beta = rows.find((row) => row.manifest.platform === 'beta');
  assert.equal(beta.recorded, false);
  assert.match(beta.reason, /HTTP 500/);
});

test('Dot.Memory unconfigured turns a real run red and makes no write', async () => {
  const w = world({ platforms: { [URLS.a]: healthy, [URLS.b]: healthy } });
  const { rows, exitCode } = await collect({ manifests: MANIFESTS, cfg: { enabled: false }, fetchImpl: w.fetchImpl, env: ENV, now: NOW, sleep: noSleep });
  assert.equal(exitCode, 1);
  assert.ok(rows.every((row) => row.recorded === false));
  assert.equal(w.memoryCalls(), 0);
});

test('a dry run fetches but never writes, and stays green even with Memory unconfigured', async () => {
  const w = world({ platforms: { [URLS.a]: healthy, [URLS.b]: healthy } });
  const { rows, exitCode } = await collect({ manifests: MANIFESTS, cfg: { enabled: false }, fetchImpl: w.fetchImpl, env: ENV, now: NOW, sleep: noSleep, dryRun: true });
  assert.equal(exitCode, 0);
  assert.ok(rows.every((row) => row.recorded === null));
  assert.equal(w.memoryCalls(), 0);
  assert.ok(rows.every((row) => row.record.event_id.startsWith('collect-')));
});

test('formatTable renders one row per platform with its outcome', () => {
  const rows = [
    { manifest: { platform: 'alpha' }, result: { reachable: true, status: 'healthy' }, recorded: true },
    { manifest: { platform: 'beta' }, result: { reachable: false, kind: 'access' }, recorded: false },
    { manifest: { platform: 'gamma' }, result: { reachable: true, status: 'warning' }, recorded: null },
  ];
  assert.equal(formatTable(rows), [
    '| platform | reachable | status | kind | recorded |',
    '|---|---|---|---|---|',
    '| alpha | yes | healthy | - | yes |',
    '| beta | no | - | access | NO |',
    '| gamma | yes | warning | - | dry-run |',
  ].join('\n'));
});

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const run = (args, env = {}) => spawnSync(process.execPath, [CLI, ...args], {
  env: { PATH: process.env.PATH, ...env },
  encoding: 'utf8',
});

test('the CLI prints usage and exits 2 without the collect command or a manifest dir', () => {
  const noArgs = run([]);
  assert.equal(noArgs.status, 2);
  assert.match(noArgs.stderr, /usage: platform-collector collect/);
  assert.equal(run(['collect']).status, 2);
});

test('the CLI exits 2 when the manifest directory does not exist', () => {
  const result = run(['collect', '--manifest-dir', '/nonexistent-dir-for-test']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /manifest error/);
});
