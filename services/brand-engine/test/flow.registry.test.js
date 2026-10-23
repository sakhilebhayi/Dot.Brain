// The check registry: auto-load, contract validation, timeouts and error isolation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileNameForId, normaliseCheckResult, validateCheckModule } from '../src/analyze/check-shape.js';
import { DEFAULT_CHECKS_DIR, listCheckFiles, loadChecks, runChecks } from '../src/analyze/registry.js';
import { REGISTRY_CHECKS, tmp, writeText } from './_flow_helpers.js';

const base = (extra = {}) => ({ id: 'd8.fixture', dimension: 'accessibility_inclusion', title: 'T', appliesTo: () => true, run: () => ({}), ...extra });
const ok = { status: 'measured', evidence: [{ check_id: 'd8.x', source_class: 'automated_check', result: 1 }], findings: [] };
const finding = (extra = {}) => ({ id: 'f1', severity: 'major', dimension: 'accessibility_inclusion', check_id: 'd8.x', message: 'm', fix_hint: 'h', ...extra });

test('the file name of a check is its id with dots and underscores as dashes', () => {
  assert.equal(fileNameForId('d8.token_pair_contrast'), 'd8-token-pair-contrast.js');
  assert.equal(fileNameForId('d10.health_endpoint'), 'd10-health-endpoint.js');
});

test('module contract: every required member is checked and nothing unknown is allowed', () => {
  assert.deepEqual(validateCheckModule(base(), 'd8-fixture.js'), []);
  assert.deepEqual(validateCheckModule(base({ 'x-note': 1 }), 'd8-fixture.js'), []);
  const cases = [
    [base({ id: 'token' }), 'id must look like'],
    [base({ id: 'd8.fixture' }), 'file name must be d8-fixture.js', 'd8-other.js'],
    [base({ dimension: 'Accessibility' }), 'dimension must be'],
    [base({ title: '' }), 'title must be'],
    [base({ appliesTo: 'yes' }), 'appliesTo must be a function'],
    [base({ run: null }), 'run must be a function'],
    [base({ extra: 1 }), 'unknown property extra'],
  ];
  for (const [mod, message, file = 'd8-fixture.js'] of cases) assert.ok(validateCheckModule(mod, file).join('|').includes(message), message);
  assert.deepEqual(validateCheckModule(null), ['the module must default-export an object']);
  assert.deepEqual(validateCheckModule('x'), ['the module must default-export an object']);
});

test('result contract: statuses, evidence and findings are validated, and a bad result never yields a pass', () => {
  assert.deepEqual(normaliseCheckResult(ok).problems, []);
  assert.equal(normaliseCheckResult({ ...ok, evidence: [{ ...ok.evidence[0], result: 'pass' }] }).result.evidence[0].value, 1);
  assert.equal(normaliseCheckResult({ ...ok, evidence: [{ ...ok.evidence[0], result: 'fail' }] }).result.evidence[0].value, 0);
  assert.equal(normaliseCheckResult({ ...ok, evidence: [{ check_id: 'd8.x', source_class: 'automated_check', value: 0.25 }] }).result.evidence[0].value, 0.25);
  const bad = [
    [null, 'must return an object'],
    [{ status: 'ok', evidence: [], findings: [] }, 'status must be one of'],
    [{ status: 'measured', evidence: 'x', findings: [] }, 'evidence must be an array'],
    [{ status: 'measured', evidence: [], findings: [] }, 'at least one evidence'],
    [{ status: 'not_measured', evidence: ok.evidence, findings: [] }, 'must not return evidence'],
    [{ status: 'not_applicable', evidence: [], findings: [finding()] }, 'must not return findings'],
    [{ ...ok, extra: 1 }, 'unknown property extra'],
    [{ ...ok, evidence: [{ ...ok.evidence[0], result: 2 }] }, 'result must be a number from 0 to 1'],
    [{ ...ok, evidence: [{ ...ok.evidence[0], result: NaN }] }, 'result must be a number from 0 to 1'],
    [{ ...ok, evidence: [{ ...ok.evidence[0], source_class: 'expert_assessment' }] }, 'source_class must be'],
    [{ ...ok, evidence: [ok.evidence[0], ok.evidence[0]] }, 'more than one entry'],
    [{ ...ok, evidence: [{ ...ok.evidence[0], check_id: 'accessibility' }] }, 'check_id must look like'],
    [{ ...ok, findings: [finding({ severity: 'fatal' })] }, 'severity must be one of'],
    [{ ...ok, findings: [finding({ message: '' })] }, 'message must be'],
    [{ ...ok, findings: [finding({ fix_hint: undefined })] }, 'fix_hint must be a string'],
    [{ ...ok, findings: [finding(), finding()] }, 'duplicate id'],
    [{ ...ok, findings: [finding({ location: { file: '../../etc/passwd' } })] }, 'location.file must be a relative path'],
    [{ ...ok, findings: [finding({ location: { file: '/etc/passwd' } })] }, 'location.file must be a relative path'],
    [{ ...ok, findings: [finding({ location: { file: 'a.css', line: 0 } })] }, 'location.line must be a positive integer'],
    [{ ...ok, findings: [finding({ kind: 'mystery' })] }, 'kind must be one of'],
    [{ ...ok, findings: [finding({ wcag_criterion: '1.4' })] }, 'wcag_criterion must look like'],
    [{ ...ok, findings: [finding({ principle: 'BXP-1' })] }, 'principle must look like'],
    [{ ...ok, findings: [finding({ surprise: 1 })] }, 'unknown property surprise'],
  ];
  for (const [raw, message] of bad) {
    const r = normaliseCheckResult(raw);
    assert.ok(r.problems.join('|').includes(message), `${message} <- ${r.problems.join('|')}`);
    assert.equal(r.result, null, 'a result with problems is not returned');
  }
  const huge = { status: 'measured', evidence: ok.evidence, findings: Array.from({ length: 2001 }, (_, i) => finding({ id: `f${i}` })) };
  assert.match(normaliseCheckResult(huge).problems.join(), /more than 2000 findings/);
});

test('text from a check is clipped, stripped of control characters and scrubbed of credentials', () => {
  const sink = {};
  const r = normaliseCheckResult({
    status: 'measured',
    evidence: [{ check_id: 'd8.x', source_class: 'automated_check', result: 1, detail: `has\u0007 control ghp_${'a'.repeat(36)} and ${'x'.repeat(3000)}`, artifact_ref: 'a b c' }],
    findings: [finding({ message: `m ${'y'.repeat(900)}`, id: 'weird id/with:chars' })],
  }, sink);
  const e = r.result.evidence[0];
  assert.ok(e.detail.length <= 1000);
  assert.ok(!e.detail.includes('ghp_') && !/[\u0000-\u001f]/.test(e.detail));
  assert.equal(e.artifact_ref, 'a_b_c');
  assert.ok(r.result.findings[0].message.length <= 500);
  assert.equal(r.result.findings[0].source_id, 'weird_id_with:chars');
  assert.ok(sink.redactions >= 1);
});

test('the registry auto-loads check modules, ignores _lib/, sub-directories, non-js files, and reports a mis-named module', async () => {
  const { files, problems } = listCheckFiles(REGISTRY_CHECKS);
  const names = files.map((f) => f.split('/').pop());
  assert.ok(!names.includes('README.md') && !names.some((n) => n.startsWith('_')) && !names.includes('d8-nested.js'));
  assert.deepEqual(problems, []);
  const { checks, errors } = await loadChecks(REGISTRY_CHECKS);
  assert.deepEqual(checks.map((c) => c.id), [
    'd8.fixture_bad_result', 'd8.fixture_empty', 'd8.fixture_env', 'd8.fixture_escape', 'd8.fixture_hang', 'd8.fixture_loop',
    'd8.fixture_na', 'd8.fixture_pass', 'd8.fixture_throw', 'd8.fixture_with_finding',
  ]);
  assert.ok(!checks.some((c) => c.id === 'd8.never_loaded' || c.id === 'd8.nested'));
  const bad = errors.map((e) => `${e.file}: ${e.message}`).join('\n');
  assert.match(bad, /d8-wrong-name\.js: file name must be d8-fixture-misnamed\.js/);
});

test('a missing checks directory is zero checks, not an error', async () => {
  assert.deepEqual(listCheckFiles(join(tmp(), 'nope')), { files: [], problems: [] });
  const r = await runChecks(join(tmp(), 'nope'), { root: tmp(), profile: {}, themes: [] });
  assert.deepEqual(r, { outcomes: [], loadErrors: [] });
});

test('a symlinked module and a directory that cannot be read are reported, not loaded', async () => {
  const dir = tmp('checks-');
  writeText(join(tmp(), 'real.js'), 'export default {}');
  const { symlinkSync } = await import('node:fs');
  symlinkSync(join(REGISTRY_CHECKS, 'd8-fixture-pass.js'), join(dir, 'd8-fixture-pass.js'));
  const { files, problems } = listCheckFiles(dir);
  assert.deepEqual(files, []);
  assert.match(problems[0].message, /symlink/);
});

test('every way a check can fail becomes not_measured with an error finding, and the rest of the run is unaffected', async () => {
  const root = tmp('reg-root-');
  writeText(join(root, 'page.html'), '<html></html>');
  const { outcomes } = await runChecks(REGISTRY_CHECKS, { root, profile: { id: 'p' }, themes: ['light', 'dark'], timeoutMs: 4000 });
  const by = Object.fromEntries(outcomes.map((o) => [o.meta.id, o]));

  assert.equal(by['d8.fixture_pass'].status, 'measured');
  assert.match(by['d8.fixture_pass'].evidence[0].detail, /themes: light,dark; files: page\.html/);
  assert.equal(by['d8.fixture_with_finding'].status, 'measured');
  assert.equal(by['d8.fixture_with_finding'].findings[0].location.line, 3);
  assert.equal(by['d8.fixture_na'].status, 'not_applicable');
  assert.equal(by['d8.fixture_env'].evidence[0].value, 1, 'the check sees an empty environment');

  const codes = { 'd8.fixture_throw': 'threw', 'd8.fixture_escape': 'threw', 'd8.fixture_loop': 'timeout', 'd8.fixture_hang': 'crashed', 'd8.fixture_bad_result': 'invalid_result', 'd8.fixture_empty': 'invalid_result' };
  for (const id of Object.keys(codes)) {
    const o = by[id];
    assert.equal(o.status, 'not_measured', id);
    assert.deepEqual(o.evidence, [], `${id}: never a pass`);
    assert.equal(o.error.code, codes[id], id);
    assert.equal(o.findings.length, 1);
    assert.equal(o.findings[0].engine, true);
    assert.equal(o.findings[0].severity, 'major');
    assert.equal(o.findings[0].check_id, id, 'the error is attributed to the check, even after a timeout');
  }
  const thrown = by['d8.fixture_throw'].findings[0].message;
  assert.ok(!thrown.includes(`s${'k'}-${'a1B2'.repeat(6)}`) && thrown.includes('[redacted]'), 'a credential in an exception message is redacted');
  assert.match(by['d8.fixture_escape'].findings[0].message, /\.\./, 'the escape attempt surfaced as a thrown error');
  assert.ok(!JSON.stringify(outcomes).includes(root), 'the checkout path never appears in a result');
});

test('the timeout is real: a check that never returns is ended, and the run finishes', async () => {
  const t0 = Date.now();
  const { outcomes } = await runChecks(REGISTRY_CHECKS, { root: tmp(), profile: {}, themes: [], timeoutMs: 700 });
  assert.ok(Date.now() - t0 < 20000);
  assert.equal(outcomes.find((o) => o.meta.id === 'd8.fixture_loop').error.code, 'timeout');
});

test('the default checks directory is src/analyze/checks and is allowed to be absent', () => {
  assert.ok(DEFAULT_CHECKS_DIR.endsWith('/src/analyze/checks/'));
});
