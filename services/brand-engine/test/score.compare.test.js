// compare: refuses across MAJOR rubric versions unless both are the same
// input; annotates MINOR; PATCH is wording; shows deltas and what evidence
// changed; never re-bases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareReports } from '../src/score/compare.js';
import { EvidenceError, Refused } from '../src/score/constants.js';
import { clone } from './_helpers.js';

const DIR = fileURLToPath(new URL('./fixtures/score/golden/', import.meta.url));
const report = (name) => JSON.parse(readFileSync(join(DIR, `${name}.report.json`), 'utf8'));
const A = () => report('automated-only');
const B = () => report('build-verified-human-expert');
const withVersion = (r, version, sha = 'c'.repeat(64)) => { const c = clone(r); c.header.rubric.version = version; c.header.rubric.sha256 = sha; return c; };
const withCommit = (r, commit) => { const c = clone(r); c.header.input.commit = commit; return c; };

test('same rubric: headline deltas, state change, per-dimension deltas and exactly which evidence changed', () => {
  const out = compareReports(A(), B());
  assert.equal(out.relationship, 'identical');
  assert.equal(out.rebased, false);
  assert.deepEqual(out.headline.evidenced_score, { baseline: 32.72, candidate: 61.45, delta: 28.73 });
  assert.deepEqual(out.headline.ceiling, { baseline: 62.2, candidate: 62.2, delta: 0 });
  assert.deepEqual(out.state, { baseline: 'not_ready', candidate: 'build_verified' });
  assert.deepEqual(out.confidence, { baseline: 'Low', candidate: 'Medium' });
  assert.equal(out.dimensions.length, 12);
  const d5 = out.dimensions.find((d) => d.id === 'functional_completeness');
  assert.equal(d5.status.baseline, 'partially_evidenced');
  assert.equal(d5.status.candidate, 'scored');
  assert.ok(d5.points_earned.delta > 0);
  // the expert assessment appeared; the not-measured placeholder is replaced
  assert.ok(d5.evidence_changes.some((c) => c.ref.startsWith('expert_assessment|')));
  assert.ok(d5.evidence_changes.every((c) => ['added', 'removed', 'changed'].includes(c.change)));
  assert.deepEqual(out.blockers, { added: [], removed: [] });
});

test('a check whose value moved is reported as changed, with both values', () => {
  const b = B();
  const a = clone(b);
  const entry = a.dimensions[0].evidence.find((e) => e.check_id === 'd1.copy_profile_language_lint');
  entry.value = 0.5; entry.result = 'partial';
  const out = compareReports(a, b);
  const change = out.dimensions[0].evidence_changes.find((c) => c.ref === 'automated_check|d1.copy_profile_language_lint');
  assert.equal(change.change, 'changed');
  assert.equal(change.baseline.value, 0.5);
  assert.equal(change.candidate.value, 1);
});

test('blockers added and removed are listed', () => {
  const out = compareReports(report('build-verified-human-expert'), report('wcag-blocker'));
  assert.deepEqual(out.blockers.added, ['wcag_failure|wcag-1']);
  assert.deepEqual(out.blockers.removed, []);
  const back = compareReports(report('wcag-blocker'), report('build-verified-human-expert'));
  assert.deepEqual(back.blockers.removed, ['wcag_failure|wcag-1']);
});

test('PATCH versions compare with a note that only wording differs', () => {
  const out = compareReports(A(), withVersion(B(), '1.0.1'));
  assert.equal(out.relationship, 'patch');
  assert.match(out.annotations[0].text, /patch \(1\.0\.0 and 1\.0\.1\): wording only, scores are unaffected/);
});

test('MINOR versions compare with an annotation that the methodology differs', () => {
  const out = compareReports(A(), withVersion(B(), '1.1.0'));
  assert.equal(out.relationship, 'minor');
  assert.equal(out.annotations[0].code, 'rubric_minor');
  assert.match(out.annotations[0].text, /part of any difference is methodology and not the product/);
  assert.equal(out.headline.evidenced_score.baseline, 32.72, 'no re-basing: the reported numbers are shown unchanged');
});

test('MAJOR versions are refused when the reports are for different commits', () => {
  const b = withCommit(withVersion(B(), '2.0.0'), 'f'.repeat(40));
  assert.throws(() => compareReports(A(), b), (e) => e instanceof Refused && /major versions differ \(1\.0\.0 and 2\.0\.0\)/.test(e.message) && /re-run on the same input/.test(e.message));
});

test('MAJOR versions are compared only when both are the same repository and commit, and say it is methodology, not progress', () => {
  const out = compareReports(A(), withVersion(B(), '2.0.0'));
  assert.equal(out.relationship, 'major');
  assert.match(out.annotations[0].text, /compares methodologies and is not a measure of progress/);
  assert.ok(out.annotations.some((a) => a.code === 'same_commit'));
  const otherRepo = withVersion(B(), '2.0.0');
  otherRepo.header.input.repo = 'fixtures/another-product';
  assert.throws(() => compareReports(A(), otherRepo), Refused);
});

test('a different rubric, or the same version with a different hash, is refused', () => {
  const other = clone(B());
  other.header.rubric.id = 'other';
  assert.throws(() => compareReports(A(), other), /different rubrics/);
  const tampered = clone(B());
  tampered.header.rubric.sha256 = 'd'.repeat(64);
  assert.throws(() => compareReports(A(), tampered), /record different hashes/);
});

test('different commits, profiles and engine versions are annotated, never hidden', () => {
  const b = withCommit(B(), '2'.repeat(40));
  b.header.profile.sha256 = 'e'.repeat(64);
  b.header.engine_version = '0.9.0'; // any version other than the current one
  const codes = compareReports(A(), b).annotations.map((x) => x.code);
  assert.deepEqual(codes, ['rubric_identical', 'profile_differs', 'engine_differs', 'commit_differs', 'not_rebased']);
});

test('invalid reports are invalid input, not a crash', () => {
  assert.throws(() => compareReports({}, B()), EvidenceError);
  assert.throws(() => compareReports(A(), null), EvidenceError);
  const broken = clone(B());
  broken.headline.out_of = 50;
  assert.throws(() => compareReports(A(), broken), /baseline|candidate/);
});

test('compare is symmetric in structure and deterministic', () => {
  const x = JSON.stringify(compareReports(A(), B()));
  assert.equal(JSON.stringify(compareReports(A(), B())), x);
  const back = compareReports(B(), A());
  assert.equal(back.headline.evidenced_score.delta, -28.73);
});
