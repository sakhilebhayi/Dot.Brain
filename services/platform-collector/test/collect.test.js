// services/platform-collector/test/collect.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
// memoryStatus(record, attempt) -- `attempt` is how many times this platform's
// record has been posted so far, starting at 1, so a handler can answer 500 and
// then 201.
function world({ platforms, memoryStatus = () => 201 }) {
  const writes = [];
  const attempts = new Map();
  let memoryCalls = 0;
  const fetchImpl = async (url, options = {}) => {
    const u = String(url);
    if (u.endsWith('/api/intelligence/events')) {
      memoryCalls += 1;
      const record = JSON.parse(options.body);
      writes.push(record);
      const attempt = (attempts.get(record.subject_id) ?? 0) + 1;
      attempts.set(record.subject_id, attempt);
      const status = memoryStatus(record, attempt);
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

test('a transient Memory failure is retried and the platform is still recorded; exit 0', async () => {
  const w = world({
    platforms: { [URLS.a]: healthy, [URLS.b]: healthy },
    memoryStatus: (record, attempt) => (record.subject_id === 'beta' && attempt === 1 ? 500 : 201),
  });
  const slept = [];
  const { rows, exitCode } = await collect({
    manifests: MANIFESTS, cfg: CFG, fetchImpl: w.fetchImpl, env: ENV, now: NOW, sleep: async (ms) => { slept.push(ms); },
  });
  assert.equal(exitCode, 0);
  assert.ok(rows.every((row) => row.recorded === true));
  assert.equal(w.writes.filter((r) => r.subject_id === 'beta').length, 2);
  assert.equal(w.writes.filter((r) => r.subject_id === 'alpha').length, 1);
  assert.deepEqual(slept, [2000]);
});

test('an unexpected throw for one platform leaves that row unrecorded, records the others, and turns the run red', async () => {
  // `ok` is read outside fetchHealth's try blocks, so this escapes fetchHealth for alpha only.
  const exploding = () => ({ get ok() { throw new Error('boom'); } });
  const w = world({ platforms: { [URLS.a]: exploding, [URLS.b]: healthy } });
  const { rows, exitCode } = await collect({ manifests: MANIFESTS, cfg: CFG, fetchImpl: w.fetchImpl, env: ENV, now: NOW, sleep: noSleep });
  assert.equal(exitCode, 1);
  assert.equal(rows.length, 2);

  const alpha = rows.find((row) => row.manifest.platform === 'alpha');
  assert.equal(alpha.recorded, false);
  assert.equal(alpha.record, null);
  assert.equal(alpha.result.reachable, false);
  assert.equal(alpha.result.kind, 'crash');
  assert.match(alpha.result.reason, /collector error: boom/);
  assert.match(alpha.reason, /collector error: boom/);

  const beta = rows.find((row) => row.manifest.platform === 'beta');
  assert.equal(beta.recorded, true);
  assert.deepEqual(w.writes.map((r) => r.subject_id), ['beta']);
});

test('a throw while building or writing a record is contained to its platform too', async () => {
  const w = world({ platforms: { [URLS.a]: healthy, [URLS.b]: healthy } });
  let calls = 0;
  const now = () => {
    calls += 1;
    if (calls === 1) throw new Error('clock broke');
    return NOW();
  };
  const { rows, exitCode } = await collect({ manifests: MANIFESTS, cfg: CFG, fetchImpl: w.fetchImpl, env: ENV, now, sleep: noSleep });
  assert.equal(exitCode, 1);
  assert.equal(rows.filter((row) => row.recorded === false).length, 1);
  assert.equal(rows.filter((row) => row.recorded === true).length, 1);
  assert.equal(w.writes.length, 1);
});

test('a throw is also contained in a dry run, and still turns the run red', async () => {
  const exploding = () => ({ get ok() { throw new Error('boom'); } });
  const w = world({ platforms: { [URLS.a]: exploding, [URLS.b]: healthy } });
  const { rows, exitCode } = await collect({ manifests: MANIFESTS, cfg: { enabled: false }, fetchImpl: w.fetchImpl, env: ENV, now: NOW, sleep: noSleep, dryRun: true });
  assert.equal(exitCode, 1);
  assert.equal(rows.find((row) => row.manifest.platform === 'alpha').recorded, false);
  assert.equal(rows.find((row) => row.manifest.platform === 'beta').recorded, null);
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

test('formatTable renders a crashed row', () => {
  const rows = [
    { manifest: { platform: 'alpha' }, result: { reachable: false, kind: 'crash', reason: 'collector error: boom' }, record: null, recorded: false, reason: 'collector error: boom' },
  ];
  assert.equal(formatTable(rows).split('\n')[2], '| alpha | no | - | crash | NO |');
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

// One valid manifest whose token is deliberately unset, so a dry run records a
// `config` failure without any network call.
function oneManifestDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'pc-'));
  writeFileSync(path.join(dir, 'x.json'), JSON.stringify({ platform: 'x', health_url: 'https://x.test/health', token_env: 'X_TOKEN' }));
  return dir;
}

test('a failed job-summary write is a warning and does not change the exit code', () => {
  const dir = oneManifestDir();
  try {
    const result = run(['collect', '--manifest-dir', dir, '--dry-run'], { GITHUB_STEP_SUMMARY: '/nonexistent-dir-for-test/summary.md' });
    assert.equal(result.status, 0);
    assert.match(result.stderr, /could not write job summary/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unexpected throw while collecting is contained: that row is unrecorded, the table still prints, exit 1', () => {
  const dir = oneManifestDir();
  try {
    // Preload that makes Date.prototype.toISOString throw, so buildObservation throws inside collect().
    const result = spawnSync(process.execPath, [
      '--import', 'data:text/javascript,Date.prototype.toISOString=()=>{throw new Error("boom")}',
      CLI, 'collect', '--manifest-dir', dir, '--dry-run',
    ], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /boom/);
    assert.match(result.stderr, /collector error/);
    assert.match(result.stdout, /\| platform \| reachable \|/);
    assert.match(result.stdout, /\| x \| no \| - \| crash \| NO \|/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a crash outside the per-platform work exits 2, not 1', () => {
  const dir = oneManifestDir();
  try {
    // Preload that makes console.log throw, so printing the table (inside the CLI's try) crashes.
    const result = spawnSync(process.execPath, [
      '--import', 'data:text/javascript,console.log=()=>{throw new Error("boom")}',
      CLI, 'collect', '--manifest-dir', dir, '--dry-run',
    ], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /crash:/);
    assert.match(result.stderr, /boom/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
