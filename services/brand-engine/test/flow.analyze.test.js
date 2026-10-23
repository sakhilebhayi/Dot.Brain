// analyze: determinism, read-only, identity from .git, redaction, rubric cross-checks, not_measured.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { scoreSchema } from '../src/score/schemas.js';
import { integrityProblems } from '../src/analyze/analyze.js';
import { readGitInfo, repoFromRemote } from '../src/analyze/git.js';
import { indexRubric } from '../src/score/rubric.js';
import { ANALYZE_CHECKS, BUNDLE, E2E_CHECKS, EMPTY_CHECKS, FAKE_COMMIT, REPORTS, analyzeCli, checksum, copyProduct, flow, tmp, writeText } from './_flow_helpers.js';

const E2E_ENV = { SECRET_TOKEN: 'env-secret-should-never-appear-9f3a', HOME_DIR: '/home/should-never-appear' };

test('the analysis is valid against its schema, carries an integrity hash and no clock, absolute path or environment value', () => {
  const dir = copyProduct();
  const r = flow(['analyze', dir, '--checks-dir', E2E_CHECKS, '--reports', REPORTS], E2E_ENV);
  assert.equal(r.code, 0, r.stderr);
  const a = JSON.parse(r.stdout);
  assert.deepEqual(scoreSchema('brand-analysis').validate(a), []);
  assert.deepEqual(integrityProblems(a), []);
  assert.equal(a.analysis_version, '1.0.0');
  for (const forbidden of [dir, E2E_ENV.SECRET_TOKEN, E2E_ENV.HOME_DIR, '/private/', '/Users/']) assert.ok(!r.stdout.includes(forbidden), forbidden);
  assert.ok(!/generated_at|timestamp|"date"/i.test(r.stdout), 'no clock');
  assert.deepEqual(a.themes, ['light', 'dark']);
  assert.equal(a.profile.id, 'e2e-fixture-product');
  assert.equal(a.profile.source, 'file');
  assert.equal(a.rubric.id, 'bxqs');
  assert.deepEqual(Object.keys(a), [...Object.keys(a)].sort(), 'keys are sorted');
});

test('the same checkout, profile and reports give byte-identical output, from any working directory, in any report order', () => {
  const dir = copyProduct();
  const first = flow(['analyze', dir, '--checks-dir', E2E_CHECKS, '--reports', REPORTS]);
  const second = flow(['analyze', dir, '--checks-dir', E2E_CHECKS, '--reports', REPORTS]);
  assert.equal(first.stdout, second.stdout);
  const elsewhere = copyProduct();
  assert.equal(flow(['analyze', elsewhere, '--checks-dir', E2E_CHECKS, '--reports', REPORTS]).stdout, first.stdout, 'a different path to an identical checkout');
  const reports = tmp('reports-');
  for (const f of readdirSync(REPORTS).reverse()) writeText(join(reports, f), readFileSync(join(REPORTS, f)));
  assert.equal(flow(['analyze', dir, '--checks-dir', E2E_CHECKS, '--reports', reports]).stdout, first.stdout, 'the same reports copied in another order');
});

test('analyze never changes the checkout: a checksum of every file and mode is identical before and after', () => {
  const dir = copyProduct({ git: true });
  const before = checksum(dir);
  const out = tmp('out-');
  assert.equal(flow(['analyze', dir, '--checks-dir', E2E_CHECKS, '--reports', REPORTS, '--out', out]).code, 0);
  assert.equal(checksum(dir), before);
  assert.deepEqual(readdirSync(out).sort(), ['analysis.json', 'summary.md']);
});

test('--out inside the checkout is refused; the engine never writes to the product repository', () => {
  const dir = copyProduct();
  for (const out of [join(dir, 'out'), dir, join(dir, 'src', 'deeper', 'out')]) {
    const r = flow(['analyze', dir, '--checks-dir', E2E_CHECKS, '--out', out]);
    assert.equal(r.code, 2, out);
    assert.match(r.stderr, /must not be inside the checkout/);
  }
  assert.equal(existsSync(join(dir, 'out')), false);
});

test('commit and repository come from .git files, never from running git, and the remote URL (with its token) is never output', () => {
  const dir = copyProduct({ git: true });
  const r = analyzeCli(dir);
  assert.deepEqual(r.analysis.input, { repo: 'example/e2e-product', commit: FAKE_COMMIT, commit_source: 'git' });
  assert.ok(!r.stdout.includes('ghp_') && !r.stdout.includes('x-access-token'));
  assert.deepEqual(analyzeCli(copyProduct()).analysis.input, { repo: null, commit: null, commit_source: 'none' });
  const flagged = analyzeCli(copyProduct(), ['--repo', 'a/b', '--commit', 'f'.repeat(40)]);
  assert.deepEqual(flagged.analysis.input, { repo: 'a/b', commit: 'f'.repeat(40), commit_source: 'flag' });
  const clash = analyzeCli(dir, ['--commit', 'f'.repeat(40)]);
  assert.equal(clash.code, 2);
  assert.match(clash.stderr, /contradicts the checkout's HEAD/);
  assert.equal(analyzeCli(dir, ['--repo', 'other/name']).code, 2);
  assert.equal(analyzeCli(dir, ['--commit', 'abc']).code, 2);
  assert.equal(analyzeCli(dir, ['--repo', 'not a repo']).code, 2);
});

test('readGitInfo: detached HEAD, packed refs, a worktree pointer, a hostile ref and a hostile pointer', () => {
  const sha = 'a'.repeat(40);
  const detached = tmp('git-');
  writeText(join(detached, '.git', 'HEAD'), `${sha}\n`);
  assert.deepEqual(readGitInfo(detached), { commit: sha, repo: null, source: 'git' });

  const packed = tmp('git-');
  writeText(join(packed, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeText(join(packed, '.git', 'packed-refs'), `# pack-refs\n${sha} refs/heads/main\n${'b'.repeat(40)} refs/heads/other\n`);
  writeText(join(packed, '.git', 'config'), '[core]\n\tbare = false\n[remote "origin"]\n\turl = git@github.com:acme/widgets.git\n');
  assert.deepEqual(readGitInfo(packed), { commit: sha, repo: 'acme/widgets', source: 'git' });

  const common = tmp('git-common-');
  writeText(join(common, 'refs', 'heads', 'feat'), `${sha}\n`);
  writeText(join(common, 'config'), '[remote "origin"]\n\turl = https://github.com/acme/widgets\n');
  const wt = join(common, 'worktrees', 'w');
  writeText(join(wt, 'HEAD'), 'ref: refs/heads/feat\n');
  writeText(join(wt, 'commondir'), '../..\n');
  const checkout = tmp('git-wt-');
  writeText(join(checkout, '.git'), `gitdir: ${wt}\n`);
  assert.deepEqual(readGitInfo(checkout), { commit: sha, repo: 'acme/widgets', source: 'git' });

  const evil = tmp('git-');
  writeText(join(evil, '.git', 'HEAD'), 'ref: refs/heads/../../../../etc/passwd\n');
  assert.equal(readGitInfo(evil).commit, null);
  const nogit = tmp('git-');
  assert.deepEqual(readGitInfo(nogit), { commit: null, repo: null, source: 'none' });
  assert.equal(repoFromRemote('https://user:tok@github.com/o/n.git'), 'o/n');
  assert.equal(repoFromRemote('https://example.com/o/n.git'), null);
});

test('a credential-shaped string in a check result is redacted and counted; the output holds no credential', () => {
  const dir = copyProduct();
  const r = analyzeCli(dir, [], ANALYZE_CHECKS);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(!/ghp_[A-Za-z0-9]{20,}|Bearer abc/.test(r.stdout));
  assert.ok(r.analysis.counts.redactions >= 2);
  assert.match(r.analysis.findings.find((f) => f.check_id === 'd6.claim_lint').message, /\[redacted\]/);
  assert.match(r.analysis.evidence.find((e) => e.check_id === 'd6.claim_lint').detail, /under <root>\/public$/, 'the checkout path a check printed is replaced');
  assert.ok(!r.stdout.includes(dir));
});

test('a check that breaks the rubric contract is not_measured with an engine finding: unknown evidence id, wrong dimension, or error', () => {
  const r = analyzeCli(copyProduct(), [], ANALYZE_CHECKS);
  const checks = Object.fromEntries(r.analysis.checks.map((c) => [c.id, c]));
  assert.equal(checks['d8.focus_visible'].status, 'not_measured');
  assert.equal(checks['d8.focus_visible'].error.code, 'invalid_result');
  assert.match(checks['d8.focus_visible'].error.message, /d8\.made_up_check, which the rubric does not define/);
  assert.equal(checks['d3.nav_depth'].error.code, 'invalid_result');
  assert.match(checks['d3.nav_depth'].error.message, /does not belong to dimension/);
  assert.equal(checks['d10.health_endpoint'].status, 'not_applicable');
  assert.equal(checks['d4.reduced_motion'].status, 'not_measured');
  assert.ok(!r.analysis.evidence.some((e) => e.check_id === 'd8.made_up_check' || e.check_id === 'd8.focus_visible' || e.check_id === 'd3.nav_depth'));
  const engine = r.analysis.findings.filter((f) => f.engine);
  assert.deepEqual(engine.map((f) => f.check_id).sort(), ['d3.nav_depth', 'd8.focus_visible']);
  const reasons = Object.fromEntries(r.analysis.not_measured.map((n) => [n.check_id, n.reason]));
  assert.equal(reasons['d8.focus_visible'], 'check_errored');
  assert.equal(reasons['d3.nav_depth'], 'check_errored');
  assert.equal(reasons['d10.health_endpoint'], 'not_applicable');
  assert.equal(reasons['d4.reduced_motion'], 'check_not_measured');
});

test('every rubric check without counted evidence is listed as not measured, with a reason; the rest are evidence', () => {
  const a = analyzeCli(copyProduct(), []).analysis;
  const rubricChecks = indexRubric(BUNDLE.rubric).checks.size;
  assert.equal(a.evidence.length + a.not_measured.length, rubricChecks);
  const reasons = Object.fromEntries(a.not_measured.map((n) => [n.check_id, n]));
  assert.equal(reasons['d8.axe_violations'].reason, 'no_report_supplied');
  assert.deepEqual(reasons['d8.axe_violations'].adapters, ['axe', 'lighthouse']);
  assert.equal(reasons['d3.nav_depth'].reason, 'no_check_registered');
  const withReports = analyzeCli(copyProduct(), ['--reports', REPORTS]).analysis;
  assert.ok(withReports.not_measured.length < a.not_measured.length);
  const empty = tmp('reports-');
  writeText(join(empty, 'axe.json'), JSON.stringify({ violations: [], passes: [] }));
  const none = analyzeCli(copyProduct(), ['--reports', empty]).analysis;
  assert.equal(none.not_measured.find((n) => n.check_id === 'd8.axe_violations').reason, 'report_had_no_data');
});

test('one check id, one source: a module and a report that both produce it are both left out, and the conflict is stated', () => {
  const dir = copyProduct();
  const reports = tmp('reports-');
  writeText(join(reports, 'results.tap'), 'TAP version 13\n1..1\nok 1 - a\n');
  const a = analyzeCli(dir, ['--reports', reports], ANALYZE_CHECKS).analysis;
  assert.deepEqual(a.conflicts, [{ check_id: 'd5.test_pass_counts', origins: ['adapter:tests', 'check:d5.test_pass_counts'] }]);
  assert.ok(!a.evidence.some((e) => e.check_id === 'd5.test_pass_counts'));
  assert.equal(a.not_measured.find((n) => n.check_id === 'd5.test_pass_counts').reason, 'conflicting_sources');
  assert.ok(a.findings.some((f) => f.engine && /More than one source produced d5\.test_pass_counts/.test(f.message)));
});

test('finding ids are stable fingerprints: the same defect keeps its id when other things change, and identical findings get an ordinal', () => {
  const dir = copyProduct();
  const first = analyzeCli(dir).analysis;
  writeText(join(dir, 'public', 'index.html'), readFileSync(join(dir, 'public', 'index.html'), 'utf8').replace('<h1>', '<p>new paragraph</p>\n<h1>'));
  const second = analyzeCli(dir).analysis;
  const tok = (a) => a.findings.find((f) => f.check_id === 'd8.token_pair_contrast').id;
  assert.equal(tok(first), tok(second), 'a different file changing does not rename the finding');
  const twice = copyProduct();
  writeText(join(twice, 'public', 'index.html'), '<!doctype html><html lang="en"><body>\n<img src="a.png">\n<img src="a.png">\n</body></html>\n');
  const ids = analyzeCli(twice).analysis.findings.filter((f) => f.check_id === 'd8.labels_alt_lang').map((f) => f.id);
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2);
  assert.ok(ids.every((id) => /^d8\.labels_alt_lang\.[0-9a-f]{12}(\.1)?$/.test(id)));
  assert.ok(ids.some((id) => id.endsWith('.1')), 'identical findings in one file are told apart by an ordinal');
});

test('--checks-dir only loads check modules from inside the engine package, never from a product checkout', () => {
  const dir = copyProduct();
  const evil = join(dir, 'my-checks');
  mkdirSync(evil, { recursive: true });
  writeText(join(evil, 'd8-token-pair-contrast.js'), 'throw new Error("must never run");');
  const r = flow(['analyze', dir, '--checks-dir', evil]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /never loaded from a product checkout/);
  assert.equal(flow(['analyze', dir, '--checks-dir', tmp()]).code, 2);
  assert.equal(flow(['analyze', dir, '--checks-dir', join(E2E_CHECKS, 'd8-token-pair-contrast.js')]).code, 2);
});

test('with no check modules at all, analyze still runs and reports every rubric check as not measured', () => {
  const r = analyzeCli(copyProduct(), [], EMPTY_CHECKS);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.analysis.evidence.length, 0);
  assert.equal(r.analysis.not_measured.length, indexRubric(BUNDLE.rubric).checks.size);
  assert.deepEqual(r.analysis.checks, []);
  assert.equal(flow(['analyze', copyProduct(), '--checks-dir', tmp('empty-')]).code, 2, 'a directory outside the package is refused');
});

test('the profile: a product profile in the checkout is found by default; --profile may name a registry profile; none at all is an error', () => {
  const dir = copyProduct();
  assert.equal(analyzeCli(dir).analysis.profile.id, 'e2e-fixture-product');
  const viaRegistry = analyzeCli(dir, ['--profile', 'infodot']);
  assert.equal(viaRegistry.analysis.profile.source, 'registry');
  assert.equal(viaRegistry.analysis.profile.id, 'infodot');
  assert.ok(viaRegistry.analysis.profile.domain_overrides.some((o) => o.principle === 'BXP-03' && o.yields_to === 'accessibility'));
  const bare = tmp('bare-');
  writeText(join(bare, 'index.html'), '<html></html>');
  const none = flow(['analyze', bare, '--checks-dir', E2E_CHECKS]);
  assert.equal(none.code, 2);
  assert.match(none.stderr, /no profile/);
  assert.equal(flow(['analyze', dir, '--checks-dir', E2E_CHECKS, '--profile', 'nonesuch']).code, 2);
});

test('--reports problems: a malformed report is exit 2 naming the file; a missing directory is exit 2', () => {
  const dir = copyProduct();
  const reports = tmp('reports-');
  writeText(join(reports, 'axe.json'), '{broken');
  const r = flow(['analyze', dir, '--checks-dir', E2E_CHECKS, '--reports', reports]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /axe\.json: axe report is not valid JSON/);
  assert.equal(flow(['analyze', dir, '--checks-dir', E2E_CHECKS, '--reports', join(reports, 'nope')]).code, 2);
});

test('--themes is passed to checks and recorded; a bad list is refused', () => {
  const dir = copyProduct();
  const a = analyzeCli(dir, ['--themes', 'light,dark,high-contrast']).analysis;
  assert.deepEqual(a.themes, ['light', 'dark', 'high-contrast']);
  assert.match(a.evidence.find((e) => e.check_id === 'd8.token_pair_contrast').detail, /themes evaluated: light, dark, high-contrast/);
  for (const bad of ['Light', 'a,a', '', 'a;b']) assert.equal(analyzeCli(dir, ['--themes', bad]).code, 2, bad);
});
