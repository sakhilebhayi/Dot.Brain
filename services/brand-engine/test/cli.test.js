// The real entry point, as a subprocess.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, parseArgs } from '../src/main.js';
import { copyBrandDir, FIXTURE, profileDoc, runCli, writeJson } from './_helpers.js';

const FIXTURE_PROFILE = join(FIXTURE, 'brand', 'profile.json');

test('profile list is sorted and shows kind, version, status and parent', () => {
  const r = runCli(['profile', 'list']);
  assert.equal(r.code, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((l) => l.split(/\s+/)[0]), ['blupin', 'dot-ecosystem', 'infodot']);
  assert.match(lines[2], /infodot\s+brand\s+0\.1\.0\s+draft\s+dot-ecosystem@0\.1\.0/);
});

test('framework list shows all twelve; framework show prints one principle as JSON', () => {
  const list = runCli(['framework', 'list']);
  assert.equal(list.code, 0);
  assert.equal(list.stdout.trim().split('\n').length, 12);
  const show = runCli(['framework', 'show', 'BXP-09']);
  assert.equal(show.code, 0);
  assert.equal(JSON.parse(show.stdout).id, 'BXP-09');
  const missing = runCli(['framework', 'show', 'BXP-99']);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /unknown principle BXP-99/);
});

test('profile show, validate and resolve work for a registry id and for a product file path', () => {
  assert.equal(JSON.parse(runCli(['profile', 'show', 'blupin']).stdout).id, 'blupin');
  assert.match(runCli(['profile', 'validate', 'infodot']).stdout, /^ok infodot@0\.1\.0 \(draft; effective draft\)$/m);
  const resolved = JSON.parse(runCli(['profile', 'resolve', 'infodot']).stdout);
  assert.deepEqual(resolved.chain, ['infodot@0.1.0', 'dot-ecosystem@0.1.0']);
  const product = runCli(['profile', 'resolve', FIXTURE_PROFILE]);
  assert.equal(product.code, 0, product.stderr);
  assert.deepEqual(JSON.parse(product.stdout).chain, ['example-product@0.1.0', 'infodot@0.1.0', 'dot-ecosystem@0.1.0']);
});

test('profile validate with no argument checks everything shipped and exits 0', () => {
  const r = runCli(['profile', 'validate']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /3 profile\(s\), 12 principle\(s\), 0 error\(s\), 0 warning\(s\)/);
});

test('output is deterministic: two runs are byte-identical', () => {
  for (const args of [['profile', 'list'], ['profile', 'resolve', 'infodot'], ['framework', 'show', 'BXP-04'], ['profile', 'validate']]) {
    assert.equal(runCli(args).stdout, runCli(args).stdout, args.join(' '));
  }
  const resolved = runCli(['profile', 'resolve', 'infodot']).stdout;
  const keys = Object.keys(JSON.parse(resolved));
  assert.deepEqual(keys, [...keys].sort(), 'keys are sorted');
});

test('no environment value ever reaches the output', () => {
  const env = { DOT_MEMORY_TOKEN: 'tok-should-never-appear-1234', KNOWLEDGE_SECRET_BRAIN: 'secret-should-never-appear-5678', GITHUB_TOKEN: 'ghs-should-never-appear' };
  for (const args of [['profile', 'list'], ['profile', 'show', 'infodot'], ['profile', 'resolve', 'infodot'], ['profile', 'validate'], ['framework', 'list'], ['drift', 'blupin', '--root', '.'], ['profile', 'show', 'nonesuch']]) {
    const r = runCli(args, env);
    const text = r.stdout + r.stderr;
    for (const value of Object.values(env)) assert.ok(!text.includes(value), args.join(' '));
  }
});

test('exit 2 and a usage line for every malformed command', () => {
  const bad = [
    [], ['nonsense'], ['profile'], ['profile', 'frobnicate'], ['profile', 'show'], ['profile', 'resolve'], ['profile', 'list', 'extra'],
    ['framework'], ['framework', 'show'], ['drift'], ['drift', 'infodot'], ['profile', 'list', '--bogus', 'x'],
    ['profile', 'list', '--brand-dir'], ['profile', 'list', '--root', 'x'], ['drift', 'infodot', '--root', 'a', '--root', 'b'],
  ];
  for (const args of bad) {
    const r = runCli(args);
    assert.equal(r.code, 2, `${args.join(' ')} -> ${r.code}`);
    assert.match(r.stderr, /usage: brand-engine/);
    assert.equal(r.stdout, '');
  }
});

test('an unknown profile or a wrong version exits 1', () => {
  assert.equal(runCli(['profile', 'show', 'nonesuch']).code, 1);
  const wrong = runCli(['profile', 'validate', 'infodot@9.9.9']);
  assert.equal(wrong.code, 1);
  assert.match(wrong.stderr, /is at 0\.1\.0, not 9\.9\.9/);
});

test('invalid brand data fails closed: every read command exits 1, and validate says why', () => {
  const dir = copyBrandDir();
  writeFileSync(join(dir, 'profiles', 'broken.profile.json'), '{');
  const list = runCli(['profile', 'list', '--brand-dir', dir]);
  assert.equal(list.code, 1);
  assert.match(list.stderr, /broken\.profile\.json: invalid JSON/);
  assert.equal(list.stdout, '');
  const v = runCli(['profile', 'validate', '--brand-dir', dir]);
  assert.equal(v.code, 1);
  assert.match(v.stderr, /error: .*broken\.profile\.json: invalid JSON/);
  assert.match(v.stdout, /1 error\(s\)|, 1 error/);
});

test('a ratified claim with no approver in the data makes the CLI exit 1', () => {
  const dir = copyBrandDir();
  const doc = profileDoc('blupin');
  doc.status = 'ratified';
  writeJson(join(dir, 'profiles', 'blupin.profile.json'), doc);
  const r = runCli(['profile', 'validate', '--brand-dir', dir]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /requires an approver/);
});

test('a broken extends in the data is reported with resolve context', () => {
  const dir = copyBrandDir();
  const doc = profileDoc('infodot');
  doc.extends = 'dot-ecosystem@0.0.1';
  writeJson(join(dir, 'profiles', 'infodot.profile.json'), doc);
  const r = runCli(['profile', 'validate', '--brand-dir', dir]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /resolve: .*registry holds dot-ecosystem@0\.1\.0/);
});

test('drift: exit 0 when the cited files match, exit 1 naming the drifted file when they do not', () => {
  const ok = runCli(['drift', FIXTURE_PROFILE, '--root', FIXTURE]);
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stdout, /2 checked, 0 drifted, 0 skipped/);

  const copy = mkdtempSync(join(tmpdir(), 'be-cli-drift-'));
  cpSync(FIXTURE, copy, { recursive: true });
  writeFileSync(join(copy, 'PRODUCT.md'), 'changed\n');
  const bad = runCli(['drift', FIXTURE_PROFILE, '--root', copy]);
  assert.equal(bad.code, 1);
  assert.match(bad.stdout, /^CHANGED example\/example-product\/PRODUCT\.md recorded [0-9a-f]{64} actual [0-9a-f]{64}$/m);
  assert.match(bad.stdout, /^OK example\/example-product\/DESIGN\.md$/m);
  assert.match(bad.stdout, /2 checked, 1 drifted/);
});

test('drift: exit 1 for a missing file; exit 2 for a bad --root or an ambiguous repository', () => {
  const empty = mkdtempSync(join(tmpdir(), 'be-cli-empty-'));
  const missing = runCli(['drift', FIXTURE_PROFILE, '--root', empty]);
  assert.equal(missing.code, 1);
  assert.match(missing.stdout, /^MISSING example\/example-product\/PRODUCT\.md$/m);

  assert.equal(runCli(['drift', FIXTURE_PROFILE, '--root', '/nonexistent/xyz']).code, 2);
  assert.equal(runCli(['drift', FIXTURE_PROFILE]).code, 2);
});

test('drift on a registry profile compares its cited files to a checkout; --repo narrows it', () => {
  const empty = mkdtempSync(join(tmpdir(), 'be-cli-empty-'));
  const r = runCli(['drift', 'infodot', '--root', empty]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /4 checked, 4 drifted, 0 skipped/);
  assert.equal(runCli(['drift', 'infodot', '--root', empty, '--repo', 'sakhilebhayi/InfoDot']).code, 1);
  const wrongRepo = runCli(['drift', 'infodot', '--root', empty, '--repo', 'other/repo']);
  assert.equal(wrongRepo.code, 2);
  assert.match(wrongRepo.stderr, /cites no files in other\/repo/);
  const none = runCli(['drift', 'blupin', '--root', empty]);
  assert.equal(none.code, 0);
  assert.match(none.stdout, /no cited files to check/);
});

test('the CLI is read-only: running every command leaves the brand directory untouched', () => {
  const dir = copyBrandDir();
  const snapshot = () => readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => { const p = join(e.parentPath, e.name); return `${p}:${statSync(p).mtimeMs}:${statSync(p).size}`; })
    .sort()
    .join('\n');
  const before = snapshot();
  for (const args of [['profile', 'list'], ['profile', 'validate'], ['profile', 'resolve', 'infodot'], ['framework', 'list'], ['drift', 'blupin', '--root', dir]]) {
    runCli([...args, '--brand-dir', dir]);
  }
  assert.equal(snapshot(), before);
});

test('main() is injectable and parseArgs rejects repeated and valueless flags', () => {
  const lines = [];
  assert.equal(main(['profile', 'list'], { out: (l) => lines.push(l), err: () => {} }), 0);
  assert.equal(lines.length, 3);
  assert.ok(parseArgs(['--root']).error);
  assert.ok(parseArgs(['--root', '--repo']).error);
  assert.ok(parseArgs(['--root', 'a', '--root', 'b']).error);
  assert.deepEqual(parseArgs(['drift', 'x', '--root', 'r']).flags, { '--root': 'r' });
});
