// The built-in checks inside the real analyzer: loaded and run by registry.js in worker threads, joined into an
// analysis, assembled into an evidence file and scored. Nothing here is mocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../../src/analyze/analyze.js';
import { assemble } from '../../src/analyze/assemble.js';
import { DEFAULT_CHECKS_DIR, listCheckFiles, loadChecks as loadMeta } from '../../src/analyze/registry.js';
import { resolveProfile } from '../../src/resolve.js';
import { scoreReport } from '../../src/score/index.js';
import { BUNDLE, REG } from '../_flow_helpers.js';
import { FIXTURES } from './_helpers.js';

const profile = resolveProfile(REG.profiles.get('infodot'), REG).resolved;
const GOOD = `${FIXTURES}good`;
const BAD = `${FIXTURES}bad`;
const run = (root) => analyze({ root, profile, rubricBundle: BUNDLE, repo: 'fixtures/synthetic', commit: 'a'.repeat(40) });

test('the registry loads all nineteen modules from the default directory with no load error', async () => {
  const { files, problems } = listCheckFiles(DEFAULT_CHECKS_DIR);
  assert.equal(files.length, 19);
  assert.deepEqual(problems, []);
  const { checks, errors } = await loadMeta();
  assert.deepEqual(errors, []);
  assert.equal(checks.length, 19);
});

test('analyze over the good fixture: every check runs, nothing errors, nothing is a blocker', async () => {
  const doc = await run(GOOD);
  assert.deepEqual(doc.engine_problems, []);
  assert.equal(doc.checks.length, 19);
  assert.ok(doc.checks.every((c) => !c.error), JSON.stringify(doc.checks.filter((c) => c.error)));
  assert.equal(doc.checks.filter((c) => c.status === 'measured').length, 18);
  assert.equal(doc.checks.find((c) => c.id === 'd6.honest_states').status, 'not_measured');
  assert.equal(doc.evidence.length, 18);
  assert.equal(doc.counts.by_severity.blocker, 0);
  assert.equal(doc.counts.by_severity.major, 0);
  assert.equal(doc.coverage.skipped_total, 0);
  // the honest note travels as a finding: the reason a check was not measured
  const note = doc.findings.find((f) => f.check_id === 'd6.honest_states');
  assert.equal(note.severity, 'info');
  assert.match(note.message, /^Not measured: no list screens/);
});

test('analyze over the bad fixture: exact blockers, with the kind and WCAG level the score needs', async () => {
  const doc = await run(BAD);
  assert.deepEqual(doc.engine_problems, []);
  assert.ok(doc.checks.every((c) => !c.error));
  const blockers = doc.findings.filter((f) => f.severity === 'blocker');
  assert.deepEqual(blockers.map((f) => `${f.check_id} ${f.kind} ${f.wcag_level ?? '-'} ${f.wcag_criterion ?? '-'} ${f.location.file}:${f.location.line}`).sort(), [
    'd6.claim_lint unsupported_claim - - resources/views/home.blade.php:5',
    'd6.claim_lint unsupported_claim - - resources/views/home.blade.php:6',
    'd6.claim_lint unsupported_claim - - resources/views/home.blade.php:6',
    'd8.labels_alt_lang wcag_failure A 1.1.1 resources/views/home.blade.php:7',
    'd8.labels_alt_lang wcag_failure A 3.1.1 resources/views/layouts/app.blade.php:2',
    'd8.labels_alt_lang wcag_failure AA 1.4.4 resources/views/layouts/app.blade.php:5',
    'd8.token_pair_contrast wcag_failure AA 1.4.3 resources/css/app.css:29',
    'd8.token_pair_contrast wcag_failure AA 1.4.3 resources/css/app.css:29',
  ]);
  assert.equal(doc.counts.by_severity.major, 25);
});

test('analyze -> assemble -> score: the blockers reach the report and the state is not_ready', async () => {
  const doc = await run(BAD);
  const evidence = assemble({ analysis: doc, rubric: BUNDLE.rubric, builtBy: 'fixture-builder', generatedAt: '2026-10-23T12:00:00Z' });
  assert.equal(evidence.findings.length, 8);
  assert.equal(evidence.automated.length, 18);
  const report = scoreReport(evidence, BUNDLE.rubric, profile);
  assert.equal(report.state, 'not_ready');
  assert.equal(report.blockers.length, 8);

  const good = await run(GOOD);
  const goodReport = scoreReport(assemble({ analysis: good, rubric: BUNDLE.rubric, builtBy: 'fixture-builder', generatedAt: '2026-10-23T12:00:00Z' }), BUNDLE.rubric, profile);
  assert.deepEqual(goodReport.blockers, []);
  assert.ok(goodReport.headline.evidenced_score > report.headline.evidenced_score);
  assert.ok(goodReport.headline.evidenced_score < goodReport.headline.ceiling);
});

test('analyze is byte-deterministic with the built-in checks', async () => {
  const a = await run(BAD);
  const b = await run(BAD);
  assert.equal(a.integrity.sha256, b.integrity.sha256);
});

test('analyze over a repository with no UI: every built-in check is not_applicable and the analysis says so', async () => {
  const doc = await analyze({ root: FIXTURES.replace(/checks\/$/, 'example-product'), profile, rubricBundle: BUNDLE, repo: 'fixtures/synthetic', commit: 'a'.repeat(40) });
  assert.equal(doc.checks.filter((c) => c.status === 'not_applicable').length, 19);
  assert.equal(doc.evidence.length, 0);
  assert.equal(doc.findings.length, 0);
  assert.ok(doc.not_measured.filter((n) => n.reason === 'not_applicable').length === 19);
});
