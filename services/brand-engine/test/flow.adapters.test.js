// Adapters: external tool reports -> evidence. Valid, malformed and hostile input.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ingestReports } from '../src/analyze/adapters/index.js';
import { AdapterError } from '../src/analyze/adapters/common.js';
import { parseXml, XmlError } from '../src/analyze/adapters/xml.js';
import { parseAssessments, parseObserved } from '../src/analyze/adapters/manual.js';
import { wcagFromTags } from '../src/analyze/adapters/axe.js';
import { REPORT_LIMITS } from '../src/analyze/limits.js';
import { BUNDLE, FAKE_TOKEN, REPORTS, tmp, writeText } from './_flow_helpers.js';

const ROOT = '/srv/checkout';
const sink = () => ({ redactions: 0 });
const dirWith = (files) => { const d = tmp('reports-'); for (const [n, t] of Object.entries(files)) writeText(join(d, n), t); return d; };
const ingest = (files) => ingestReports(dirWith(files), { root: ROOT, sink: sink() });
const rejects = (files, re) => assert.throws(() => ingest(files), (e) => e instanceof AdapterError && re.test(e.message), JSON.stringify(Object.keys(files)));
const byCheck = (r) => Object.fromEntries(r.evidence.map((e) => [e.check_id, e]));
const read = (name) => readFileSync(join(REPORTS, name), 'utf8');

// ---------------------------------------------------------------- detector
test('detector: the real output format is parsed, de-duplicated, routed to d2 and d4, and scaled against the ceiling', () => {
  const r = ingest({ 'impeccable-detect.json': read('impeccable-detect.json') });
  const e = byCheck(r);
  assert.equal(e['d2.impeccable_detect_findings'].value, 0.5, '5 identity hits of 10');
  assert.equal(e['d4.detector_clean'].value, 0.9, '1 detail hit (low-contrast) of 10');
  assert.match(e['d2.impeccable_detect_findings'].detail, /5 distinct detector finding\(s\) counted against a ceiling of 10/);
  assert.equal(r.findings.length, 6, '8 raw entries, 2 duplicates');
  const f = r.findings.find((x) => x.source_id === 'low-contrast');
  assert.equal(f.check_id, 'd4.detector_clean');
  assert.equal(f.dimension, 'visual_interaction_craftsmanship');
  assert.equal(f.location.file, 'public/index.html', 'an absolute path inside the checkout becomes relative');
  const outside = ingestReports(dirWith({ 'detect.json': JSON.stringify([{ antipattern: 'side-tab', file: '/home/someone/else/page.html', line: 2 }]) }), { root: ROOT, sink: sink() });
  assert.equal(outside.findings[0].location.file, 'external/page.html', 'a path outside the checkout never appears as an absolute path');
  assert.equal(f.severity, 'minor');
});

test('detector: an empty array is a clean run, advisory hits are not counted, a path inside the checkout becomes relative', () => {
  const clean = ingest({ 'detect.json': '[]' });
  assert.equal(byCheck(clean)['d2.impeccable_detect_findings'].value, 1);
  const mixed = ingest({ 'detect.json': JSON.stringify([
    { antipattern: 'overused-font', category: 'slop', severity: 'warning', file: `${ROOT}/public/a.html`, line: 3, snippet: 'inter' },
    { antipattern: 'em-dash-overuse', category: 'slop', severity: 'advisory', file: `${ROOT}/public/a.html`, line: 0, snippet: '—' },
    { antipattern: 'bounce-easing', category: 'slop', severity: 'warning', file: `${ROOT}/public/a.css`, line: 9, snippet: 'cubic-bezier' },
    { antipattern: 'future-rule', category: 'brand-new-category', severity: 'warning', file: 'src/b.html', line: 0, snippet: '' },
  ]) });
  const e = byCheck(mixed);
  assert.equal(e['d2.impeccable_detect_findings'].value, 0.9, 'only the font counts as identity; the advisory hit does not');
  assert.equal(e['d4.detector_clean'].value, 0.8, 'the motion rule and the unknown category count as detail');
  assert.match(e['d4.detector_clean'].detail, /1 hit\(s\) had a category the rubric does not name/);
  const font = mixed.findings.find((f) => f.source_id === 'overused-font');
  assert.deepEqual(font.location, { file: 'public/a.html', line: 3 });
  assert.equal(mixed.findings.find((f) => f.source_id === 'em-dash-overuse').severity, 'info');
});

test('detector: findings at or above the ceiling score zero and never go negative', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ antipattern: 'side-tab', category: 'slop', severity: 'warning', file: 'a.html', line: i + 1, snippet: 'x' }));
  assert.equal(byCheck(ingest({ 'detect.json': JSON.stringify(many) }))['d2.impeccable_detect_findings'].value, 0);
});

test('detector: malformed reports are rejected with a clear error', () => {
  rejects({ 'detect.json': '{not json' }, /not valid JSON/);
  rejects({ 'detect.json': '{"antipattern":"x"}' }, /JSON array/);
  rejects({ 'detect.json': '[1]' }, /entry 0 is not an object/);
  rejects({ 'detect.json': '[{"file":"a.html"}]' }, /no valid antipattern/);
  rejects({ 'detect.json': '[{"antipattern":"BAD ID","file":"a.html"}]' }, /no valid antipattern/);
  rejects({ 'detect.json': '[{"antipattern":"x"}]' }, /no file/);
  rejects({ 'detect.json': '[{"antipattern":"x","file":"a","line":-1}]' }, /invalid line/);
  rejects({ 'detect.json': '[{"antipattern":"x","file":"a","severity":5}]' }, /invalid severity/);
});

// ---------------------------------------------------------------- axe
test('axe: rule share, WCAG level and criterion from tags, blockers for A and AA, URL stripped of query and fragment', () => {
  const r = ingest({ 'axe.json': read('axe.json') });
  const e = byCheck(r)['d8.axe_violations'];
  assert.equal(e.value, 6 / 9);
  assert.match(e.detail, /6 of 9 axe-core rules passing across 1 page\(s\); 1 incomplete/);
  const img = r.findings.find((f) => f.source_id === 'image-alt');
  assert.deepEqual([img.severity, img.kind, img.wcag_level, img.wcag_criterion], ['blocker', 'wcag_failure', 'A', '1.1.1']);
  assert.match(img.fix_hint, /Affected \(2 elements\): img\.hero; img\.logo/);
  assert.equal(img.message, 'axe rule image-alt: Images must have alternate text', 'the message has no counts, so it is stable until the rule passes');
  const contrast = r.findings.find((f) => f.source_id === 'color-contrast');
  assert.deepEqual([contrast.wcag_level, contrast.wcag_criterion], ['AA', '1.4.3']);
  const region = r.findings.find((f) => f.source_id === 'region');
  assert.equal(region.severity, 'minor');
  assert.equal(region.kind, undefined, 'a best-practice rule is not a WCAG failure');
  assert.equal(img.location.file, 'fixture.example/index.html');
  assert.ok(!JSON.stringify(r).includes('should-not-appear'));
});

test('axe: tag parsing, pooling across pages, and rejection of the wrong tool or shape', () => {
  assert.deepEqual(wcagFromTags(['wcag2aa', 'wcag143', 'cat.color']), { level: 'AA', criterion: '1.4.3' });
  assert.deepEqual(wcagFromTags(['wcag22aa', 'wcag2411']), { level: 'AA', criterion: '2.4.11' });
  assert.deepEqual(wcagFromTags(['wcag2a', 'wcag2aa']), { level: 'A', criterion: undefined });
  assert.deepEqual(wcagFromTags(['best-practice', 7, null]), { level: undefined, criterion: undefined });
  const page = (vio, pass) => ({ url: 'https://x.example/p', violations: vio.map((id) => ({ id, impact: 'minor', tags: [], nodes: [] })), passes: pass.map((id) => ({ id })) });
  const pooled = ingest({ 'axe.json': JSON.stringify([page(['a'], ['b', 'c']), page(['b'], ['a', 'c', 'd'])]) });
  assert.equal(byCheck(pooled)['d8.axe_violations'].value, 2 / 4, 'a rule that fails on any page fails; a and b fail, c and d pass');
  rejects({ 'axe.json': '{}' }, /"violations" and "passes"/);
  rejects({ 'axe.json': JSON.stringify({ testEngine: { name: 'pa11y' }, violations: [], passes: [] }) }, /not axe-core/);
  rejects({ 'axe.json': JSON.stringify({ violations: [{ nodes: [] }], passes: [] }) }, /valid rule id/);
  rejects({ 'axe.json': JSON.stringify({ violations: [], passes: [{ id: '../x y' }] }) }, /valid rule id/);
  rejects({ 'axe.json': '[]' }, /no results/);
  const none = ingest({ 'axe.json': JSON.stringify({ violations: [], passes: [] }) });
  assert.deepEqual(none.evidence, [], 'no rules at all is no evidence, not a pass');
});

// ---------------------------------------------------------------- lighthouse
test('lighthouse: only accessibility becomes evidence; best-practices and performance are noted and never scored; axe wins when both exist', () => {
  const r = ingest({ 'lighthouse.json': read('lighthouse.json') });
  const e = byCheck(r);
  assert.deepEqual(Object.keys(e), ['d8.axe_violations']);
  assert.equal(e['d8.axe_violations'].value, 0.5, '2 of 4 applicable audits pass; the manual audit is not counted');
  assert.match(e['d8.axe_violations'].detail, /audit-level/);
  assert.ok(r.notes.some((n) => /best-practices category 92\/100 \(noted, not scored/.test(n)));
  assert.ok(r.notes.some((n) => /performance category 55\/100 \(noted, not scored/.test(n)));
  assert.ok(r.findings.every((f) => f.severity === 'major' && f.kind === undefined), 'no WCAG level in Lighthouse, so no blocker is invented');
  assert.ok(!JSON.stringify(r).includes('session=abc'));

  const both = ingest({ 'lighthouse.json': read('lighthouse.json'), 'axe.json': read('axe.json') });
  assert.equal(byCheck(both)['d8.axe_violations'].origin, 'adapter:axe');
  assert.deepEqual(both.superseded, [{ check_id: 'd8.axe_violations', origin: 'adapter:lighthouse', superseded_by: 'adapter:axe' }]);
  assert.ok(!both.findings.some((f) => f.origin === 'adapter:lighthouse'), 'the superseded report contributes no findings either');
});

test('lighthouse: rejects what is not a Lighthouse report', () => {
  rejects({ 'lighthouse.json': '{"categories":{}}' }, /lighthouseVersion, categories and audits/);
  rejects({ 'lighthouse.json': '[]' }, /lighthouseVersion/);
});

// ---------------------------------------------------------------- tests
test('junit and tap are pooled: pass share excludes skipped, error-path tests need the tag, failures are blockers', () => {
  const r = ingest({ 'junit.xml': read('junit.xml'), 'results.tap': read('results.tap') });
  const e = byCheck(r);
  assert.equal(e['d5.test_pass_counts'].value, 5 / 7);
  assert.match(e['d5.test_pass_counts'].detail, /5 passed, 2 failed, 2 skipped of 9 test\(s\) in 2 report\(s\)/);
  assert.equal(e['d10.error_path_tests'].value, 0.5);
  assert.deepEqual(r.findings.map((f) => f.message).sort(), ['Test failed: ledger.errors [error-path] reports a missing file', 'Test failed: rejects a cycle']);
  assert.ok(r.findings.every((f) => f.severity === 'blocker' && f.kind === 'failing_test' && f.check_id === 'd5.test_pass_counts'));
  assert.equal(r.findings.find((f) => /missing file/.test(f.message)).location.file, 'tests/ledger_test.js');
  assert.equal(r.ingested.length, 2);
});

test('tests: a run with no executed test, or a truncated TAP plan, is not a pass', () => {
  const none = ingest({ 'junit.xml': '<testsuite name="x"><testcase name="a"><skipped/></testcase></testsuite>' });
  assert.deepEqual(none.evidence, []);
  assert.match(none.notes[0], /no test executed/);
  rejects({ 'results.tap': 'TAP version 13\n1..5\nok 1 - a\nok 2 - b\n' }, /plans 5 test\(s\) but contains 2/);
  rejects({ 'results.tap': 'TAP version 13\nok 1 - a\nBail out! database down\n' }, /Bail out/);
  rejects({ 'results.tap': 'TAP version 13\n1..0\n' }, /no test points/);
  const todo = ingest({ 'results.tap': 'TAP version 13\n1..2\nok 1 - a\nnot ok 2 - later # TODO not built\n' });
  assert.equal(byCheck(todo)['d5.test_pass_counts'].value, 1, 'a TODO failure is not a failure');
});

test('tests: nested subtests are part of their parent and are not counted twice', () => {
  const tap = 'TAP version 13\n# Subtest: group\n    ok 1 - inner a\n    not ok 2 - inner b\n    1..2\nnot ok 1 - group\n1..1\n';
  const r = ingest({ 'results.tap': tap });
  assert.equal(byCheck(r)['d5.test_pass_counts'].value, 0);
  assert.equal(r.findings.length, 1);
});

test('junit: malformed or hostile XML is rejected', () => {
  rejects({ 'junit.xml': '<testsuite><testcase name="a"></testsuite>' }, /not acceptable XML/);
  rejects({ 'junit.xml': '<report><x/></report>' }, /<testsuites> or <testsuite>/);
  rejects({ 'junit.xml': '<testsuite><testcase classname="c"/></testsuite>' }, /without a name/);
  rejects({ 'junit.xml': '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY a "aaaa">]><testsuite><testcase name="&a;"/></testsuite>' }, /DOCTYPE and entity declarations are not allowed/);
  rejects({ 'junit.xml': '<testsuite><testcase name="&nbsp;"/></testsuite>' }, /unsupported entity/);
  rejects({ 'junit.xml': '<testsuite><testcase name="a" name="b"/></testsuite>' }, /duplicate attribute/);
});

test('xml reader: structure, entities, limits and no DOCTYPE', () => {
  const root = parseXml('<?xml version="1.0"?><!-- c --><a x="1 &amp; 2"><b><![CDATA[<raw>]]></b><c/></a>');
  assert.equal(root.attrs.x, '1 & 2');
  assert.equal(root.children[0].text, '<raw>');
  assert.equal(parseXml('<a>&#65;&#x42;</a>').text, 'AB');
  for (const bad of ['', 'text', '<a>', '<a></b>', '<a/><b/>', '<a x=1/>', '<a x="<"/>', '<a>&#0;</a>', '<a>&#xD800;</a>', '<a>&unknown;</a>', '<!DOCTYPE a><a/>', '<a><![CDATA[x</a>', '<a><!-- x</a>', '<a x></a>', '<a>&amp</a>']) {
    assert.throws(() => parseXml(bad), XmlError, JSON.stringify(bad));
  }
  assert.throws(() => parseXml(`${'<a>'.repeat(60)}${'</a>'.repeat(60)}`), /nesting deeper/);
  assert.throws(() => parseXml(`<a>${'<b/>'.repeat(50)}</a>`, { maxNodes: 10 }), /more than 10 elements/);
  assert.equal(parseXml(`<a>${'x'.repeat(100000)}</a>`).text.length, 2000, 'character data is bounded');
  const t0 = Date.now();
  parseXml(`<a>${'<b x="y"/>'.repeat(40000)}</a>`);
  assert.ok(Date.now() - t0 < 5000, 'linear time on a large file');
});

// ---------------------------------------------------------------- the directory
test('the reports directory: routing by name then content, skips are listed with a reason, links and binaries are never read', () => {
  const d = tmp('reports-');
  writeText(join(d, 'notes.txt'), 'just notes');
  writeText(join(d, 'other.json'), '{"hello":"world"}');
  writeText(join(d, 'broken.json'), '{nope');
  writeText(join(d, 'sniffed.json'), read('axe.json'));
  writeText(join(d, 'assessments.json'), JSON.stringify({ format: 'brand-assessments/1' }));
  writeFileSync(join(d, 'blob.bin'), Buffer.from([0, 1, 2]));
  writeText(join(d, '.hidden.json'), '[]');
  symlinkSync(join(REPORTS, 'axe.json'), join(d, 'linked.axe.json'));
  const r = ingestReports(d, { root: ROOT, sink: sink() });
  assert.deepEqual(r.ingested.map((x) => `${x.file}:${x.adapter}`), ['sniffed.json:axe']);
  const skipped = Object.fromEntries(r.skipped.map((s) => [s.file, s.reason]));
  assert.match(skipped['notes.txt'], /not a recognised report type/);
  assert.match(skipped['other.json'], /no adapter recognises/);
  assert.match(skipped['broken.json'], /not valid JSON/);
  assert.match(skipped['assessments.json'], /evidence assemble/);
  assert.match(skipped['blob.bin'], /binary/);
  assert.match(skipped['linked.axe.json'], /symlink/);
  assert.ok(!('.hidden.json' in skipped));
});

test('size and count caps: an oversized file, too many files, or too many bytes in total are refused', () => {
  const big = 'a'.repeat(REPORT_LIMITS.maxFileBytes + 1);
  rejects({ 'detect.json': big }, /larger than/);
  const many = {};
  for (let i = 0; i <= REPORT_LIMITS.maxFiles; i += 1) many[`f${String(i).padStart(3, '0')}.txt`] = 'x';
  rejects(many, /more than 50 files/);
  const cap = REPORT_LIMITS.maxTotalBytes;
  const chunk = 'x'.repeat(REPORT_LIMITS.maxFileBytes - 10);
  const files = {};
  for (let i = 0; i < Math.ceil(cap / chunk.length) + 1; i += 1) files[`n${i}.txt`] = chunk;
  rejects(files, /over 33554432 bytes/);
  assert.throws(() => ingestReports(join(tmp(), 'missing'), { root: ROOT, sink: sink() }), AdapterError);
});

test('hostile JSON: prototype keys, deep nesting and huge arrays neither pollute nor crash', () => {
  const polluted = ingest({ 'axe.json': '{"__proto__":{"polluted":true},"violations":[],"passes":[{"id":"a"}],"constructor":{"prototype":{"x":1}}}' });
  assert.equal(({}).polluted, undefined);
  assert.equal(byCheck(polluted)['d8.axe_violations'].value, 1);
  rejects({ 'detect.json': `${'['.repeat(100000)}${']'.repeat(100000)}` }, /not valid JSON|JSON array|entry 0/);
  const tooMany = JSON.stringify(Array.from({ length: REPORT_LIMITS.maxFindings + 1 }, () => ({ antipattern: 'x', file: 'a' })));
  rejects({ 'detect.json': tooMany }, /more than 5000 findings/);
});

test('free text from reports is bounded, stripped of control characters and scrubbed of credentials', () => {
  const name = `adds\u0007 a ghp_${'b'.repeat(36)} line ${'z'.repeat(500)}`;
  const xml = `<testsuite><testcase name="${name}"><failure/></testcase></testsuite>`;
  const r = ingestReports(dirWith({ 'junit.xml': xml }), { root: ROOT, sink: sink() });
  const text = r.findings[0].message;
  assert.ok(text.length <= 500 && !text.includes('ghp_') && !/[\u0000-\u001f]/.test(text));
  assert.match(text, /\[redacted\]/);
});

// ---------------------------------------------------------------- manual assessments
const assessments = (over = {}) => JSON.stringify({
  format: 'brand-assessments/1', recorded_at: '2026-10-23T12:00:00Z',
  assessors: [{ id: 'jane', kind: 'human' }, { id: 'ai-1', kind: 'ai' }],
  assessments: [{ dimension: 'usability_cognitive_load', assessor: 'jane', level: 3, notes: 'Direct, with friction on secondary screens.', artifact_ref: 'notes/jane.md' }],
  ...over,
});
const badAssess = (over, re) => assert.throws(() => parseAssessments('a.json', assessments(over), BUNDLE.rubric), (e) => e instanceof AdapterError && re.test(e.message), JSON.stringify(over).slice(0, 80));

test('assessments: the level is recorded beside the rubric anchor it means, with the assessor kind', () => {
  const r = parseAssessments('a.json', assessments(), BUNDLE.rubric);
  assert.deepEqual(r.assessors, [{ id: 'ai-1', kind: 'ai' }, { id: 'jane', kind: 'human' }]);
  assert.equal(r.expert.length, 1);
  assert.match(r.expert[0].rationale, /^Level 3 \(rubric anchor: Main tasks are direct and clear, with minor friction on secondary screens\.\) Assessor notes: Direct, with friction/);
  assert.equal(r.recorded_at, '2026-10-23T12:00:00Z');
});

test('assessments: strict validation of every field', () => {
  const entry = (o) => ({ dimension: 'usability_cognitive_load', assessor: 'jane', level: 3, notes: 'ok', artifact_ref: 'n', ...o });
  badAssess({ format: 'other' }, /\$\.format/);
  badAssess({ recorded_at: 'yesterday' }, /recorded_at/);
  badAssess({ surprise: 1 }, /\$\.surprise: is not an allowed property/);
  badAssess({ assessors: [] }, /non-empty array/);
  badAssess({ assessors: [{ id: 'a', kind: 'robot' }] }, /kind: must be "human" or "ai"/);
  badAssess({ assessors: [{ id: 'a', kind: 'human' }, { id: 'a', kind: 'ai' }] }, /duplicate assessor/);
  badAssess({ assessments: [entry({ dimension: 'made_up' })] }, /unknown dimension/);
  badAssess({ assessments: [entry({ dimension: 'retention_continuing_value' })] }, /cannot be assessed by an expert/);
  badAssess({ assessments: [entry({ assessor: 'nobody' })] }, /not declared in assessors/);
  badAssess({ assessments: [entry({ level: 5 })] }, /integer from 0 to 4/);
  badAssess({ assessments: [entry({ level: 2.5 })] }, /integer from 0 to 4/);
  badAssess({ assessments: [entry({ notes: '' })] }, /must say why/);
  badAssess({ assessments: [entry({ notes: 'x'.repeat(701) })] }, /longer than 700/);
  badAssess({ assessments: [entry({ artifact_ref: 'has space' })] }, /artifact_ref/);
  badAssess({ assessments: [entry(), entry()] }, /more than one assessment/);
  badAssess({ assessments: [entry({ extra: 1 })] }, /is not an allowed property/);
  badAssess({ assessments: [entry({ notes: `token ${FAKE_TOKEN} here` })] }, /looks like a credential/);
  assert.throws(() => parseAssessments('a.json', '{nope', BUNDLE.rubric), /not valid JSON/);
  assert.throws(() => parseAssessments('a.json', '[]', BUNDLE.rubric), /must be a JSON object/);
});

// ---------------------------------------------------------------- manual observed
const observed = (o = {}, top = {}) => JSON.stringify({
  format: 'brand-observed/1', recorded_at: '2026-10-23T12:30:00Z',
  observations: [{ dimension: 'usability_cognitive_load', source_class: 'observed_behaviour', metric_id: 'task_completion_rate', value: 0.8, n: 8, method: 'Moderated sessions', participants: 'human', artifact_ref: 'notes/s.md', ...o }],
  ...top,
});
const badObs = (o, re, top) => assert.throws(() => parseObserved('o.json', observed(o, top), BUNDLE.rubric), (e) => e instanceof AdapterError && re.test(e.message), JSON.stringify(o).slice(0, 80));

test('observed: a valid result keeps its class, n, method and value exactly', () => {
  const r = parseObserved('o.json', observed(), BUNDLE.rubric);
  assert.deepEqual(r.observed, [{ dimension: 'usability_cognitive_load', source_class: 'observed_behaviour', metric_id: 'task_completion_rate', value: 0.8, n: 8, method: 'Moderated sessions', artifact_ref: 'notes/s.md' }]);
  const feedback = parseObserved('o.json', observed({ source_class: 'customer_feedback', metric_id: 'ease_rating' }), BUNDLE.rubric);
  assert.equal(feedback.observed[0].source_class, 'customer_feedback');
});

test('observed: prohibited engagement metrics are REFUSED with the reason, whatever they are called', () => {
  for (const metric of ['session_time', 'Session Time', 'daily_active_users', 'app_opens', 'scroll_depth', 'notification_click_through', 'streak_length', 'time_to_return', 'variable_reward_effectiveness', 'minutes_in_app', 'weekly-active-users']) {
    badObs({ metric_id: metric, dimension: 'retention_continuing_value' }, /prohibited engagement metric .*brain\.dopemine\.md/, undefined);
  }
});

test('observed: unknown metrics, wrong class, simulated participants, bad numbers and secrets are all refused', () => {
  badObs({ metric_id: 'happiness' }, /not a metric the rubric defines/);
  badObs({ source_class: 'customer_feedback' }, /is a observed_behaviour metric, not customer_feedback/);
  badObs({ participants: 'ai' }, /participants: must be "human"/);
  badObs({ participants: undefined }, /participants: must be "human"/);
  badObs({ value: 1.2 }, /value: must be a number from 0 to 1/);
  badObs({ value: '0.5' }, /value: must be a number/);
  badObs({ n: 0 }, /whole number of people/);
  badObs({ n: 2.5 }, /whole number of people/);
  badObs({ method: '' }, /must say how this was run/);
  badObs({ dimension: 'nope' }, /unknown dimension/);
  badObs({ artifact_ref: '' }, /artifact_ref/);
  badObs({ detail: `key ${FAKE_TOKEN}` }, /looks like a credential/);
  assert.throws(() => parseObserved('o.json', JSON.stringify({ format: 'brand-observed/1', recorded_at: '2026-10-23T12:30:00Z', observations: [JSON.parse(observed()).observations[0], JSON.parse(observed()).observations[0]] }), BUNDLE.rubric), /more than one result/);
});

test('observed: n below the rubric minimum is NOT dropped here; the scorer rejects it visibly', () => {
  const r = parseObserved('o.json', observed({ n: 2 }), BUNDLE.rubric);
  assert.equal(r.observed[0].n, 2);
});
