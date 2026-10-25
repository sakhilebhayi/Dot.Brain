// The contract between the built-in checks and the registry/analyzer that loads them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { CHECKS_DIR, FIXTURES, PROFILE, loadChecks, reasonOf, runOn, tmpRepo } from './_helpers.js';
import { RUBRIC, PROFILE as SCORE_PROFILE, emptyEvidence } from '../_score_helpers.js';
import { scoreReport } from '../../src/score/index.js';
import { SKIPPED } from '../../src/analyze/checks/_lib/skipped.js';
import { createFiles } from '../../src/analyze/files.js';

const checks = await loadChecks();
const rubricChecks = new Map(RUBRIC.dimensions.flatMap((d) => d.evidence.automated_check.checks.map((c) => [c.id, d.id])));
const STATUSES = ['measured', 'not_applicable', 'not_measured'];
const SEVERITIES = ['blocker', 'major', 'minor', 'info'];

test('the folder holds one module per check, named after the check id, and nothing the registry could mistake for one', () => {
  const files = readdirSync(CHECKS_DIR).filter((n) => !n.startsWith('.'));
  const modules = files.filter((n) => n.endsWith('.js') && !n.startsWith('_'));
  assert.deepEqual(modules.sort(), [...checks.keys()].map((id) => `${id.replaceAll('.', '-').replaceAll('_', '-')}.js`).sort());
  // the only other entry is the _lib folder, which the registry must ignore
  assert.deepEqual(files.filter((n) => !modules.includes(n)).sort(), ['_lib']);
});

test('every module id is an automated check id of the released rubric, on the right dimension', () => {
  for (const [id, { mod }] of checks) {
    assert.ok(rubricChecks.has(id), `${id} is not in the rubric`);
    assert.equal(mod.dimension, rubricChecks.get(id), `${id} dimension`);
    assert.equal(typeof mod.title, 'string');
    assert.ok(mod.title.length > 5);
    assert.equal(typeof mod.appliesTo, 'function');
    assert.equal(typeof mod.run, 'function');
    assert.equal(mod.id, id);
  }
});

test('every automated check of the rubric is either built or listed as skipped with a reason, never both, never neither', () => {
  const built = new Set(checks.keys());
  const skipped = new Set(Object.keys(SKIPPED));
  for (const id of built) assert.ok(!skipped.has(id), `${id} is both built and skipped`);
  for (const id of skipped) assert.ok(rubricChecks.has(id), `${id} is skipped but not a rubric check`);
  assert.deepEqual([...rubricChecks.keys()].filter((id) => !built.has(id) && !skipped.has(id)), [], 'a rubric check is neither built nor skipped');
  for (const [id, why] of Object.entries(SKIPPED)) assert.ok(typeof why === 'string' && why.length > 20, id);
  assert.equal(built.size + skipped.size, rubricChecks.size);
});

function assertResultShape(id, mod, r) {
  assert.ok(STATUSES.includes(r.status), `${id} status ${r.status}`);
  assert.ok(Array.isArray(r.evidence) && Array.isArray(r.findings));
  assert.deepEqual(Object.keys(r).sort(), ['evidence', 'findings', 'status'], `${id}: the analyzer rejects any other key in a result`);
  if (r.status !== 'measured') {
    assert.deepEqual(r.evidence, [], `${id}: ${r.status} must not carry evidence`);
    if (r.status === 'not_applicable') assert.deepEqual(r.findings, [], `${id}: not_applicable must not carry findings`);
    else assert.equal(typeof reasonOf(r), 'string', `${id}: not_measured must say why`);
  } else {
    assert.equal(r.evidence.length, 1, id);
    const [e] = r.evidence;
    assert.equal(e.check_id, id);
    assert.equal(e.source_class, 'automated_check');
    assert.ok(typeof e.result === 'number' && e.result >= 0 && e.result <= 1, `${id} result ${e.result}`);
    assert.ok(typeof e.detail === 'string' && e.detail.length > 0 && e.detail.length <= 1000, `${id} detail length`);
    assert.match(e.artifact_ref, /^[^\s]{1,300}$/, `${id} artifact_ref`);
  }
  const seen = new Set();
  for (const f of r.findings) {
    assert.match(f.id, /^[A-Za-z0-9_.-]{1,80}$/, `${id} finding id`);
    assert.ok(!seen.has(f.id), `${id}: duplicate finding id ${f.id}`);
    seen.add(f.id);
    assert.ok(f.id.startsWith(`${id}.`));
    assert.ok(SEVERITIES.includes(f.severity), f.severity);
    assert.equal(f.dimension, mod.dimension);
    assert.equal(f.check_id, id);
    assert.ok(typeof f.message === 'string' && f.message.length > 0 && f.message.length <= 400);
    assert.ok(typeof f.fix_hint === 'string' && f.fix_hint.length > 0);
    if (f.id.includes('.not-measured.')) assert.equal(f.severity, 'info');
    else {
      assert.ok(f.location && typeof f.location.file === 'string' && Number.isInteger(f.location.line) && f.location.line >= 1, `${id} location`);
      assert.ok(!/^\//.test(f.location.file) && !f.location.file.includes('..'), `${id}: location must be relative to the checkout`);
    }
    for (const k of Object.keys(f)) assert.ok(['id', 'severity', 'dimension', 'check_id', 'message', 'location', 'fix_hint', 'kind', 'wcag_level', 'wcag_criterion', 'principle'].includes(k), `${id}: unknown finding key ${k}`);
    if (f.kind !== undefined) assert.equal(f.severity, 'blocker', 'only blockers carry a rubric finding kind');
  }
}

test('every module returns the contract shape on a good repo, a bad repo, a repo with no UI and an unreadable root', () => {
  const roots = [`${FIXTURES}good`, `${FIXTURES}bad`, tmpRepo({ 'README.md': 'x' }), '/nope/not/a/dir'];
  for (const [id, { mod }] of checks) {
    for (const root of roots) {
      for (const profile of [PROFILE, null]) {
        const r = runOn(checks, id, root, profile);
        assertResultShape(id, mod, r);
        assert.equal(typeof mod.appliesTo({ root, profile }), 'boolean');
      }
    }
  }
});

test('appliesTo and run agree, and run never throws on a context with extra or missing members', () => {
  const root = `${FIXTURES}bad`;
  for (const [id, { mod }] of checks) {
    const ctx = { root, profile: PROFILE, files: { list: () => ['../../etc/passwd'], read: () => 'ignored', exists: () => true }, themes: { x: 1 }, options: undefined };
    assert.equal(mod.appliesTo(ctx), mod.run(ctx).status !== 'not_applicable', id);
    assert.doesNotThrow(() => mod.run({ root }), id);
    assert.doesNotThrow(() => mod.run({ root, profile: undefined }), id);
  }
});

test('through the analyzer\'s file API the results are identical to a direct walk, and what the API declined is not read', () => {
  for (const name of ['good', 'bad']) {
    const root = `${FIXTURES}${name}`;
    const direct = [...checks.keys()].map((id) => JSON.stringify(runOn(checks, id, root, PROFILE)));
    const files = createFiles(root);
    const viaApi = [...checks.keys()].map((id) => JSON.stringify(runOn(checks, id, root, PROFILE, { files: files.api })));
    assert.deepEqual(viaApi, direct, name);
    assert.deepEqual(files.skipped(), [], 'nothing in the fixtures needed to be skipped');
  }
  // minified, vendored and oversized files are declined by the API, recorded, and never reach a check
  const root = tmpRepo({
    'resources/views/a.blade.php': '<p>A seamless start</p>',
    'resources/views/vendor/x.blade.php': '<p>seamless</p>',
    'resources/css/app.css': `.a{color:#fff;background:#fff}${' '.repeat(10100)}`,
    'resources/css/ok.css': '.b{color:#111;background:#fff}',
  });
  const files = createFiles(root);
  const r = runOn(checks, 'd8.token_pair_contrast', root, PROFILE, { files: files.api });
  assert.equal(r.status, 'measured');
  assert.deepEqual(files.skipped().map((x) => `${x.path} ${x.reason}`), ['resources/css/app.css minified_or_generated', 'resources/views/vendor vendored_or_generated_directory']);
  assert.match(r.evidence[0].detail, /Not read: 1 minified or generated\./);
});

test('a hostile or broken ctx.files degrades to "unreadable"; it never reads outside the checkout', () => {
  const root = `${FIXTURES}bad`;
  const baseline = [...checks.keys()].map((id) => JSON.stringify(runOn(checks, id, root, PROFILE)));
  const hostile = {
    list: () => ['../../etc/passwd', '/etc/passwd', 'a\\b', 'resources/../../x', 42, null, '', 'resources/views/home.blade.php', 'vendor/x.blade.php', 'node_modules/y/z.html', 'resources/css/app.css'],
    read: () => { throw Object.assign(new Error('nope'), { code: 'DENIED' }); },
    exists: () => { throw new Error('must not matter'); },
  };
  for (const [id] of checks) assert.doesNotThrow(() => runOn(checks, id, root, PROFILE, { files: hostile }), id);
  // nothing could be read, so nothing is measured: and nothing is passed
  for (const id of ['d8.token_pair_contrast', 'd8.labels_alt_lang', 'd6.claim_lint']) assert.notEqual(runOn(checks, id, root, PROFILE, { files: hostile }).status, 'measured', id);
  // a provider whose list() throws or returns a non-array falls back to the confined walk
  for (const broken of [{ list: () => { throw new Error('x'); }, read: () => null }, { list: () => 'nope', read: () => null }, { list: 1, read: 2 }, null, 'files']) {
    const again = [...checks.keys()].map((id) => JSON.stringify(runOn(checks, id, root, PROFILE, { files: broken })));
    assert.deepEqual(again, baseline);
  }
});

test('the output is acceptable input to `score`: evidence validates, blockers block, a clean run does not', () => {
  const toEvidence = (root) => {
    const ev = emptyEvidence();
    for (const [id, { mod }] of checks) {
      const r = runOn(checks, id, root, PROFILE);
      for (const e of r.evidence) ev.automated.push({ check_id: e.check_id, value: e.result, detail: e.detail, artifact_ref: e.artifact_ref });
      for (const f of r.findings.filter((x) => x.kind)) {
        ev.findings.push({ id: f.id, kind: f.kind, dimension: mod.dimension, ...(f.wcag_level ? { level: f.wcag_level } : {}), ...(f.wcag_criterion ? { criterion: f.wcag_criterion } : {}), detail: f.message, artifact_ref: `${f.location.file}:${f.location.line}` });
      }
    }
    return ev;
  };
  const bad = scoreReport(toEvidence(`${FIXTURES}bad`), RUBRIC, SCORE_PROFILE());
  assert.equal(bad.state, 'not_ready');
  assert.equal(bad.blockers.length, 8, '3 unsupported claims, 3 low-level WCAG failures in the markup and 2 in the contrast pairs');
  const good = scoreReport(toEvidence(`${FIXTURES}good`), RUBRIC, SCORE_PROFILE());
  assert.deepEqual(good.blockers, []);
  assert.equal(good.state, 'not_ready', 'no expert, no observed evidence: the automated checks alone cannot ship anything');
  assert.ok(good.headline.evidenced_score > 0 && good.headline.evidenced_score < good.headline.ceiling, 'a clean run earns something, and less than its ceiling');
  assert.ok(good.headline.evidenced_score > bad.headline.evidenced_score);
});
