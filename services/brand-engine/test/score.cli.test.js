// score, compare and rubric as subprocesses: exit codes, determinism, no
// secrets, read-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/main.js';
import { BRAND, FIXTURE, copyBrandDir, readJsonFile, runCli, writeJson } from './_helpers.js';
import { AI_A, BUILDER, HUMAN, buildSideEvidence, copy, expertFor } from './_score_helpers.js';
import { validateReportShape } from '../src/score/schemas.js';

const FIXTURE_PROFILE = join(FIXTURE, 'brand', 'profile.json');
const tmp = () => mkdtempSync(join(tmpdir(), 'bxqs-cli-'));
const put = (dir, name, value) => { const p = join(dir, name); writeJson(p, value); return p; };

function snapshot(dir) {
  const out = [];
  const walk = (d) => { for (const f of readdirSync(d).sort()) { const p = join(d, f); const s = statSync(p); if (s.isDirectory()) walk(p); else out.push(`${p}:${s.size}:${s.mtimeMs}`); } };
  walk(dir);
  return out.join('\n');
}

test('score: a report for a registry profile, exit 0, valid, deterministic, keys sorted', () => {
  const dir = tmp();
  const ev = put(dir, 'evidence.json', buildSideEvidence());
  const r = runCli(['score', '--evidence', ev, '--profile', 'infodot']);
  assert.equal(r.code, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.deepEqual(validateReportShape(report), []);
  assert.equal(report.header.profile.id, 'infodot');
  assert.equal(report.header.profile.effective_status, 'draft');
  assert.equal(report.header.rubric.version, '1.0.0');
  assert.equal(report.state, 'build_verified');
  assert.equal(report.headline.evidenced_score, 62.2);
  assert.equal(runCli(['score', '--evidence', ev, '--profile', 'infodot']).stdout, r.stdout, 'byte-identical');
  assert.equal(runCli(['score', '--evidence', ev, '--profile', 'infodot', '--rubric', 'bxqs-1.0.0']).stdout, r.stdout);
  const keys = Object.keys(report);
  assert.deepEqual(keys, [...keys].sort());
});

test('score: a product profile loaded from a path', () => {
  const dir = tmp();
  const ev = put(dir, 'evidence.json', buildSideEvidence());
  const r = runCli(['score', '--evidence', ev, '--profile', FIXTURE_PROFILE]);
  assert.equal(r.code, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.header.profile.kind, 'product');
  assert.deepEqual(report.header.profile.chain, ['example-product@0.1.0', 'infodot@0.1.0', 'dot-ecosystem@0.1.0']);
});

test('score: --built-by is applied, so a builder that is the only assessor is rejected', () => {
  const dir = tmp();
  const e = buildSideEvidence({ assessors: [AI_A], builtBy: undefined });
  delete e.built_by;
  e.assessors = [AI_A];
  e.expert = expertFor(['functional_completeness'], AI_A, 4);
  const ev = put(dir, 'evidence.json', e);
  const without = JSON.parse(runCli(['score', '--evidence', ev, '--profile', 'infodot']).stdout);
  assert.equal(without.rejected_evidence.length, 0);
  assert.ok(without.release_ready_unmet.some((x) => x.code === 'builder_not_declared'));
  const withFlag = JSON.parse(runCli(['score', '--evidence', ev, '--profile', 'infodot', '--built-by', AI_A.id]).stdout);
  assert.equal(withFlag.rejected_evidence.find((x) => x.reason_code === 'builder_sole_assessor').ref, AI_A.id);
  assert.equal(withFlag.header.input.built_by, AI_A.id);
});

test('exit 2 for invalid input: missing flags, unreadable or malformed evidence, unknown profile, contradictory --built-by, schema errors', () => {
  const dir = tmp();
  const good = put(dir, 'evidence.json', buildSideEvidence());
  const notJson = join(dir, 'not.json');
  writeFileSync(notJson, '{ nope');
  const schemaBad = put(dir, 'bad.json', { ...buildSideEvidence(), generated_at: 'yesterday' });
  const secret = put(dir, 'secret.json', { ...buildSideEvidence(), findings: [{ id: 'f', kind: 'failing_test', detail: `token gh${'p'}_${'z'.repeat(30)}`, artifact_ref: 'a' }] });
  const cases = [
    [['score'], /score needs --evidence and --profile/],
    [['score', '--evidence', good], /score needs --evidence and --profile/],
    [['score', '--profile', 'infodot'], /score needs --evidence and --profile/],
    [['score', '--evidence', join(dir, 'missing.json'), '--profile', 'infodot'], /cannot read/],
    [['score', '--evidence', notJson, '--profile', 'infodot'], /invalid JSON/],
    [['score', '--evidence', good, '--profile', 'no-such-profile'], /unknown profile no-such-profile/],
    [['score', '--evidence', good, '--profile', 'infodot@9.9.9'], /profile infodot is at 0\.1\.0/],
    [['score', '--evidence', good, '--profile', 'infodot', '--built-by', 'someone-else'], /contradicts built_by/],
    [['score', '--evidence', schemaBad, '--profile', 'infodot'], /invalid: .*generated_at/],
    [['score', '--evidence', secret, '--profile', 'infodot'], /looks like a credential/],
    [['score', '--evidence', good, '--profile', 'infodot', '--bogus', 'x'], /unknown argument --bogus/],
    [['score', '--evidence', good, '--evidence', good, '--profile', 'infodot'], /given twice/],
    [['score', '--evidence', good, '--profile'], /needs a value/],
    [['score', 'extra', '--evidence', good, '--profile', 'infodot'], /unexpected argument extra/],
    [['compare', 'only-one.json'], /exactly two report files/],
    [['compare', join(dir, 'a.json'), join(dir, 'b.json')], /cannot read/],
    [['rubric'], /rubric needs show or validate/],
    [['rubric', 'frobnicate'], /rubric needs show or validate/],
    [['rubric', 'show', 'x', 'y'], /rubric needs show or validate/],
  ];
  for (const [args, pattern] of cases) {
    const r = runCli(args);
    assert.equal(r.code, 2, `${args.join(' ')} -> ${r.code}\n${r.stderr}`);
    assert.match(r.stderr, pattern, args.join(' '));
    assert.equal(r.stdout, '', `${args.join(' ')} prints no report`);
  }
});

test('exit 3 (refused) for a modified rubric, an unreleased rubric, and invalid brand data', () => {
  const dir = tmp();
  const ev = put(dir, 'evidence.json', buildSideEvidence());

  const edited = copyBrandDir();
  const path = join(edited, 'rubrics', 'bxqs-1.0.0.json');
  const rubric = readJsonFile(path);
  rubric.dimensions[0].weight = 9; rubric.dimensions[1].weight = 6;
  writeJson(path, rubric);
  const a = runCli(['score', '--evidence', ev, '--profile', 'infodot', '--brand-dir', edited]);
  assert.equal(a.code, 3);
  assert.match(a.stderr, /modified since release/);
  assert.equal(a.stdout, '');

  const missing = copyBrandDir();
  const b = runCli(['score', '--evidence', ev, '--profile', 'infodot', '--brand-dir', missing, '--rubric', 'bxqs-2.0.0']);
  assert.equal(b.code, 3);

  const broken = copyBrandDir();
  writeFileSync(join(broken, 'profiles', 'blupin.profile.json'), '{}');
  const c = runCli(['score', '--evidence', ev, '--profile', 'infodot', '--brand-dir', broken]);
  assert.equal(c.code, 3);
  assert.match(c.stderr, /brand data is invalid/);
});

test('compare: exit 0 with a comparison, exit 3 across a major version for different commits, exit 2 for a non-report', () => {
  const dir = tmp();
  const ev1 = put(dir, 'e1.json', buildSideEvidence({ automated: 0.5 }));
  const ev2 = put(dir, 'e2.json', buildSideEvidence({ automated: 1 }));
  const r1 = runCli(['score', '--evidence', ev1, '--profile', 'infodot']).stdout;
  const r2 = runCli(['score', '--evidence', ev2, '--profile', 'infodot']).stdout;
  const p1 = join(dir, 'r1.json'); writeFileSync(p1, r1);
  const p2 = join(dir, 'r2.json'); writeFileSync(p2, r2);
  const c = runCli(['compare', p1, p2]);
  assert.equal(c.code, 0, c.stderr);
  const out = JSON.parse(c.stdout);
  assert.equal(out.relationship, 'identical');
  assert.ok(out.headline.evidenced_score.delta > 0);
  assert.equal(runCli(['compare', p1, p2]).stdout, c.stdout);

  const major = JSON.parse(r2);
  major.header.rubric.version = '2.0.0'; major.header.rubric.sha256 = 'a'.repeat(64); major.header.input.commit = 'b'.repeat(40);
  const pm = join(dir, 'major.json'); writeFileSync(pm, JSON.stringify(major));
  const refused = runCli(['compare', p1, pm]);
  assert.equal(refused.code, 3);
  assert.match(refused.stderr, /not comparable across a major version unless both are re-run on the same input/);
  assert.equal(refused.stdout, '');

  const bad = put(dir, 'notareport.json', { hello: 'world' });
  assert.equal(runCli(['compare', p1, bad]).code, 2);
});

test('no environment value ever reaches the output of score, compare or rubric', () => {
  const dir = tmp();
  const ev = put(dir, 'evidence.json', buildSideEvidence());
  const env = { DOT_MEMORY_TOKEN: 'tok-should-never-appear-1234', GITHUB_TOKEN: 'ghs-should-never-appear', KNOWLEDGE_SECRET_BRAIN: 'secret-should-never-appear-5678' };
  const report = join(dir, 'r.json');
  writeFileSync(report, runCli(['score', '--evidence', ev, '--profile', 'infodot'], env).stdout);
  for (const args of [['score', '--evidence', ev, '--profile', 'infodot'], ['rubric', 'show'], ['rubric', 'validate'], ['compare', report, report], ['score', '--evidence', ev, '--profile', 'nonesuch']]) {
    const r = runCli(args, env);
    for (const value of Object.values(env)) assert.ok(!(r.stdout + r.stderr).includes(value), args.join(' '));
  }
});

test('the scoring commands are read-only: nothing under brand/ or the evidence directory changes', () => {
  const dir = tmp();
  const ev = put(dir, 'evidence.json', buildSideEvidence());
  const before = [snapshot(BRAND), snapshot(dir)];
  runCli(['score', '--evidence', ev, '--profile', 'infodot']);
  runCli(['rubric', 'validate']);
  assert.deepEqual([snapshot(BRAND), snapshot(dir)], before);
});

test('the generated_at in the report is the evidence\'s own: the CLI reads no clock', () => {
  const dir = tmp();
  const e = buildSideEvidence();
  e.generated_at = '2001-02-03T04:05:06Z';
  const ev = put(dir, 'evidence.json', e);
  assert.equal(JSON.parse(runCli(['score', '--evidence', ev, '--profile', 'infodot']).stdout).header.generated_at, '2001-02-03T04:05:06Z');
});

test('the foundation commands still work and malformed top-level commands still exit 2', () => {
  assert.equal(runCli(['profile', 'validate']).code, 0);
  assert.equal(runCli(['framework', 'list']).code, 0);
  for (const args of [[], ['nonsense'], ['scored']]) assert.equal(runCli(args).code, 2);
  const lines = [];
  assert.equal(main([], { out: () => {}, err: (l) => lines.push(l) }), 2);
  assert.match(lines.join('\n'), /brand-engine score --evidence/);
});

test('main() delegates score, compare and rubric with injectable output (no process needed)', () => {
  const out = [];
  const code = main(['rubric', 'validate'], { out: (l) => out.push(l), err: () => {} });
  assert.equal(code, 0);
  assert.match(out[0], /^ok bxqs-1\.0\.0 sha256=[0-9a-f]{64}/);
});
