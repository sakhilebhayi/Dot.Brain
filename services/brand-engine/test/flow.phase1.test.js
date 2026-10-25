// Phase 1 workflow defects: the detector adapter keeps URL `file` values opaque (D2), says when its ceiling is reached (D3/D5), and the
// manual assessments file carries declarations (D7). Everything here is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ingestReports } from '../src/analyze/adapters/index.js';
import { AdapterError, urlIdentifier } from '../src/analyze/adapters/common.js';
import { parseAssessments } from '../src/analyze/adapters/manual.js';
import { scoreSchema } from '../src/score/schemas.js';
import { BUNDLE, FAKE_COMMIT, flow, tmp, writeText } from './_flow_helpers.js';

const ROOT = '/srv/checkout';
const sink = () => ({ redactions: 0 });
const dirWith = (files) => { const d = tmp('reports-'); for (const [n, t] of Object.entries(files)) writeText(join(d, n), t); return d; };
const hit = (file, extra = {}) => ({ antipattern: 'side-tab', category: 'slop', severity: 'warning', file, line: 0, snippet: 'border-left: 4px', ...extra });
const ingest = (hits) => ingestReports(dirWith({ 'detect.json': JSON.stringify(hits) }), { root: ROOT, sink: sink() });

// ------------------------------------------------------------------ D2: URL file values
test('D2 detector: a URL file value is an opaque identifier, with no scheme, host, port, query or fragment of a local server', () => {
  const r = ingest([
    hit('http://127.0.0.1:8801/_snap/dashboard.html?token=abc#top', { antipattern: 'gradient-text' }),
    hit('http://localhost:3000/', { antipattern: 'overused-font' }),
    hit('http://192.168.1.20:8080/reports/team.html', { antipattern: 'bounce-easing' }),
  ]);
  assert.deepEqual(r.findings.map((f) => f.location.file).sort(), ['url:/', 'url:/_snap/dashboard.html', 'url:/reports/team.html']);
  const text = JSON.stringify(r);
  for (const leaked of ['127.0.0.1', '8801', 'localhost', '3000', '192.168', '8080', 'token=abc', '#top', 'http:']) assert.ok(!text.includes(leaked), `${leaked} must not appear`);
});

test('D2 detector: the old mangling (http:/127.0.0.1:8801/...) is gone for every URL shape', () => {
  for (const [input, want] of [
    ['http://127.0.0.1:8801/_snap/x.html', 'url:/_snap/x.html'],
    ['https://[::1]:8443/a/b.html', 'url:/a/b.html'],
    ['http://dev.test/page', 'url:/page'],
    ['http://myhost/page', 'url:/page'],
    ['https://user:secret@app.example.com:8443/pricing?plan=1', 'url:app.example.com/pricing'],
    ['https://example.com', 'url:example.com/'],
    ['data:text/html,<p>x</p>', 'url:(data)'],
    ['blob:https://example.com/1234', 'url:(blob)'],
  ]) {
    const id = urlIdentifier(input, sink());
    assert.equal(id, want, input);
    assert.ok(!id.includes('secret') && !id.includes('plan=1') && !id.includes(':8443') && !id.includes('http'), id);
  }
  assert.equal(urlIdentifier('/abs/path.html', sink()), null, 'a path is not a URL');
  assert.equal(urlIdentifier('rendered/page.html', sink()), null);
  assert.equal(urlIdentifier('file:///srv/checkout/public/a.html', sink()), null, 'a file URL is a path');
  const r = ingest([hit('file:///srv/checkout/public/a.html'), hit('file:///elsewhere/b.html', { antipattern: 'gradient-text' })]);
  assert.deepEqual(r.findings.map((f) => f.location.file).sort(), ['external/b.html', 'public/a.html'], 'a file URL is made relative to the checkout like any path');
});

test('D2 detector: the same page served on two ports is one page, and paths still become relative to the checkout', () => {
  const r = ingest([hit('http://127.0.0.1:8801/_snap/x.html'), hit('http://127.0.0.1:9902/_snap/x.html'), hit(`${ROOT}/public/index.html`)]);
  assert.equal(r.findings.length, 2);
  assert.equal(r.evidence.find((e) => e.check_id === 'd2.impeccable_detect_findings').detail.match(/(\d+) distinct/)[1], '2');
});

test('D2 analyze: a detector report about a served page reaches analysis.json, the plan and the summary without the port', () => {
  const dir = tmp('d2-product-');
  writeText(join(dir, 'resources/views/home.blade.php'), '<h1>Home</h1>');
  const reports = dirWith({ 'impeccable-detect.json': JSON.stringify([hit('http://127.0.0.1:8801/_snap/home.html')]) });
  const out = tmp('d2-out-');
  const a = flow(['analyze', dir, '--repo', 'example/served', '--commit', FAKE_COMMIT, '--profile', 'infodot', '--reports', reports, '--out', out]);
  assert.equal(a.code, 0, a.stderr);
  const p = flow(['plan', join(out, 'analysis.json'), '--out', join(out, 'plan')]);
  assert.equal(p.code, 0, p.stderr);
  const files = ['analysis.json', 'summary.md', 'plan/plan.json', 'plan/plan.md'].map((f) => readFileSync(join(out, f), 'utf8'));
  for (const text of [a.stdout, p.stdout, ...files]) assert.ok(!/127\.0\.0\.1|8801/.test(text), 'no local host or port in any output');
  assert.ok(files[0].includes('"file": "url:/_snap/home.html"') || files[0].includes('"file":"url:/_snap/home.html"'), 'the identifier is in the analysis');
  assert.ok(files[2].includes('url:/_snap/home.html'), 'and in the plan, where a reader can tell it is not a file of the checkout');
});

// ------------------------------------------------------------------ D3 / D5: the ceiling says when it is reached
const many = (n) => Array.from({ length: n }, (_, i) => hit('a.html', { line: i + 1, snippet: `s${i}` }));
const ev = (hits, id = 'd2.impeccable_detect_findings') => ingest(hits).evidence.find((e) => e.check_id === id);

test('D3 detector: at or past the ceiling the evidence says SATURATED and carries the flag; below it nothing changes', () => {
  const nine = ev(many(9));
  assert.ok(Math.abs(nine.value - 0.1) < 1e-9);
  assert.equal(nine.saturated, undefined);
  assert.ok(!/SATURATED/.test(nine.detail));
  const ten = ev(many(10));
  assert.equal(ten.value, 0);
  assert.equal(ten.saturated, true);
  assert.match(ten.detail, /^SATURATED: 10 distinct detector finding\(s\) counted against a ceiling of 10/);
  assert.match(ten.detail, /The value 0 is a floor: 10 and more hits read the same/);
  const big = ev(many(191));
  assert.equal(big.value, 0, 'the value is unchanged: no new scoring');
  assert.match(big.detail, /^SATURATED: 191 distinct/);
  assert.match(big.detail, /10 and 191 hits read the same/);
  assert.ok(big.detail.length <= 1000);
});

test('D3 detector: the two checks saturate on their own counts, and advisory hits never count toward the ceiling', () => {
  const identity = many(12);
  const detail = Array.from({ length: 3 }, (_, i) => hit('b.html', { antipattern: 'low-contrast', category: 'quality', line: i + 1, snippet: `c${i}` }));
  const advisory = Array.from({ length: 30 }, (_, i) => hit('c.html', { antipattern: 'em-dash-overuse', severity: 'advisory', line: i + 1, snippet: `a${i}` }));
  const r = ingest([...identity, ...detail, ...advisory]);
  const d2 = r.evidence.find((e) => e.check_id === 'd2.impeccable_detect_findings');
  const d4 = r.evidence.find((e) => e.check_id === 'd4.detector_clean');
  assert.equal(d2.saturated, true);
  assert.equal(d4.saturated, undefined);
  assert.equal(d4.value, 0.7);
});

test('D3 analysis: a saturated source makes an analysis 1.1.0 with the flag on the row; an unsaturated one stays 1.0.0, byte for byte', () => {
  const dir = tmp('d3-product-');
  writeText(join(dir, 'resources/views/home.blade.php'), '<h1>Home</h1>');
  const base = ['analyze', dir, '--repo', 'example/served', '--commit', FAKE_COMMIT, '--profile', 'infodot'];
  const calm = flow([...base, '--reports', dirWith({ 'detect.json': JSON.stringify(many(3)) })]);
  const loud = flow([...base, '--reports', dirWith({ 'detect.json': JSON.stringify(many(40)) })]);
  const calmDoc = JSON.parse(calm.stdout);
  const loudDoc = JSON.parse(loud.stdout);
  assert.equal(calmDoc.analysis_version, '1.0.0');
  assert.equal(loudDoc.analysis_version, '1.1.0');
  assert.deepEqual(scoreSchema('brand-analysis').validate(calmDoc), []);
  assert.deepEqual(scoreSchema('brand-analysis').validate(loudDoc), []);
  assert.equal(loudDoc.evidence.find((e) => e.check_id === 'd2.impeccable_detect_findings').saturated, true);
  assert.equal(calmDoc.evidence.find((e) => e.check_id === 'd2.impeccable_detect_findings').saturated, undefined);
  // verify still compares a 1.0.0 baseline with a 1.1.0 analysis: the major is the same
  const out = tmp('d3-out-');
  writeText(join(out, 'analysis.json'), calm.stdout);
  const v = flow(['verify', '--before', join(out, 'analysis.json'), dir, ...base.slice(2), '--reports', dirWith({ 'detect.json': JSON.stringify(many(40)) })]);
  assert.notEqual(v.code, 2, v.stderr);
});

test('D3 chain: analysis -> evidence assemble -> score carries the flag to the report, and the report says the floor was left out', () => {
  const dir = tmp('d3-chain-');
  writeText(join(dir, 'resources/views/home.blade.php'), '<h1>Home</h1>');
  const out = tmp('d3-chain-out-');
  const reports = dirWith({ 'detect.json': JSON.stringify(many(40)) });
  assert.equal(flow(['analyze', dir, '--repo', 'example/served', '--commit', FAKE_COMMIT, '--profile', 'infodot', '--reports', reports, '--out', out]).code, 0);
  const e = flow(['evidence', 'assemble', '--analysis', join(out, 'analysis.json'), '--built-by', 'builder', '--generated-at', '2026-10-23T12:00:00Z', '-o', join(out, 'evidence.json')]);
  assert.equal(e.code, 0, e.stderr);
  const evidence = JSON.parse(flow(['evidence', 'assemble', '--analysis', join(out, 'analysis.json'), '--built-by', 'builder', '--generated-at', '2026-10-23T12:00:00Z']).stdout);
  assert.equal(evidence.evidence_version, '1.1.0');
  assert.equal(evidence.automated.find((a) => a.check_id === 'd2.impeccable_detect_findings').saturated, true);
  const s = flow(['score', '--evidence', join(out, 'evidence.json'), '--profile', 'infodot']);
  assert.equal(s.code, 0, s.stderr);
  const report = JSON.parse(s.stdout);
  assert.equal(report.report_version, '1.1.0');
  assert.ok(report.confidence.reasons.some((r) => r.code === 'saturated_left_out'));
  const row = report.dimensions.find((d) => d.id === 'brand_distinctiveness').evidence.find((x) => x.check_id === 'd2.impeccable_detect_findings');
  assert.equal(row.saturated, true);
  assert.match(row.detail, /^SATURATED:/);
});

// ------------------------------------------------------------------ D7: the assessments file carries declarations
const V2 = (assessors, extra = {}) => JSON.stringify({
  format: 'brand-assessments/2', recorded_at: '2026-10-23T12:00:00Z', assessors,
  assessments: [{ dimension: 'usability_cognitive_load', assessor: 'ai-1', level: 3, notes: 'Direct, with friction on secondary screens.', artifact_ref: 'notes/ai-1.md' }],
  ...extra,
});
const parse = (text) => parseAssessments('a.json', text, BUNDLE.rubric);
const parseFails = (text, re) => assert.throws(() => parse(text), (e) => e instanceof AdapterError && re.test(e.message));
const FRESH = { built_the_change: false, fresh_reviewer: true, ai_only: true, statement: 'AI only. Fresh reviewer: did not build this change and saw no earlier conclusions.' };

test('D7 assessments/2: an assessor carries kind plus AI-only, fresh-reviewer and built-the-change declarations in its own words', () => {
  const r = parse(V2([{ id: 'ai-1', kind: 'ai', declaration: FRESH }, { id: 'jane', kind: 'human', declaration: { built_the_change: false } }]));
  assert.deepEqual(r.assessors, [
    { id: 'ai-1', kind: 'ai', declaration: FRESH },
    { id: 'jane', kind: 'human', declaration: { built_the_change: false } },
  ]);
  assert.equal(r.expert[0].assessor, 'ai-1');
});

test('D7 assessments: format /1 files stay valid and unchanged, and /1 cannot carry a declaration', () => {
  const v1 = JSON.stringify({ format: 'brand-assessments/1', recorded_at: '2026-10-23T12:00:00Z', assessors: [{ id: 'ai-1', kind: 'ai' }], assessments: [{ dimension: 'usability_cognitive_load', assessor: 'ai-1', level: 3, notes: 'ok', artifact_ref: 'n' }] });
  const r = parse(v1);
  assert.deepEqual(r.assessors, [{ id: 'ai-1', kind: 'ai' }], 'no declaration key at all');
  assert.equal(parse(V2([{ id: 'ai-1', kind: 'ai' }])).assessors[0].declaration, undefined, 'a /2 file may declare nothing');
  parseFails(v1.replace('"kind":"ai"', '"kind":"ai","declaration":{"fresh_reviewer":true}'), /declaration: needs format "brand-assessments\/2"/);
});

test('D7 assessments/2: contradictions and malformed declarations are refused with the field named', () => {
  const a = (declaration, kind = 'ai') => V2([{ id: 'ai-1', kind, declaration }]);
  parseFails(a({}), /must declare at least one thing/);
  parseFails(a('yes'), /declaration: must be an object/);
  parseFails(a({ fresh_reviewer: 'yes' }), /fresh_reviewer: must be true or false/);
  parseFails(a({ made_up: true }), /made_up: is not an allowed property/);
  parseFails(a({ built_the_change: true, fresh_reviewer: true }), /cannot also be a fresh reviewer/);
  parseFails(a({ ai_only: false }), /ai_only: false contradicts kind "ai"/);
  parseFails(a({ ai_only: true }, 'human'), /ai_only: true contradicts kind "human"/);
  parseFails(a({ statement: '' }), /statement: must be 1 to 700 characters/);
  parseFails(a({ statement: 'y'.repeat(701) }), /statement: must be 1 to 700 characters/);
  parseFails(a({ statement: `token ${'gh'}${'p'}_${'A1b2C3'.repeat(6)}` }), /looks like a credential/);
});

test('D7 evidence assemble: declarations reach a 1.1.0 evidence file; a file without them stays 1.0.0; --built-by cannot be contradicted', () => {
  const dir = tmp('d7-');
  writeText(join(dir, 'resources/views/home.blade.php'), '<h1>Home</h1>');
  const out = tmp('d7-out-');
  assert.equal(flow(['analyze', dir, '--repo', 'example/served', '--commit', FAKE_COMMIT, '--profile', 'infodot', '--out', out]).code, 0);
  const analysis = join(out, 'analysis.json');
  const write = (name, text) => { const p = join(out, name); writeText(p, text); return p; };
  const base = ['evidence', 'assemble', '--analysis', analysis, '--generated-at', '2026-10-23T12:00:00Z'];

  const declared = write('declared.json', V2([{ id: 'ai-1', kind: 'ai', declaration: FRESH }]));
  const ok = flow([...base, '--built-by', 'prior-ai-sessions', '--assessments', declared]);
  assert.equal(ok.code, 0, ok.stderr);
  const evidence = JSON.parse(ok.stdout);
  assert.equal(evidence.evidence_version, '1.1.0');
  assert.deepEqual(evidence.assessors, [{ id: 'ai-1', kind: 'ai', declaration: FRESH }]);

  const plain = write('plain.json', V2([{ id: 'ai-1', kind: 'ai' }]));
  assert.equal(JSON.parse(flow([...base, '--built-by', 'prior-ai-sessions', '--assessments', plain]).stdout).evidence_version, '1.0.0');

  // the builder says it did not build it: refused. The builder is whoever --built-by names.
  const liar = write('liar.json', V2([{ id: 'ai-1', kind: 'ai', declaration: { built_the_change: false, fresh_reviewer: true } }]));
  const refused = flow([...base, '--built-by', 'ai-1', '--assessments', liar]);
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /says this assessor did not build the change, but it is the built_by/);
  const claims = write('claims.json', V2([{ id: 'ai-1', kind: 'ai', declaration: { built_the_change: true } }]));
  const mismatch = flow([...base, '--built-by', 'someone-else', '--assessments', claims]);
  assert.equal(mismatch.code, 2);
  assert.match(mismatch.stderr, /says this assessor built the change, but built_by is "someone-else"/);

  // and the whole chain scores: the builder's own assessment earns nothing, the declaration changes no number
  const evPath = write('ev.json', ok.stdout);
  const withDecl = JSON.parse(flow(['score', '--evidence', evPath, '--profile', 'infodot']).stdout);
  const noDecl = JSON.parse(flow(['score', '--evidence', write('ev0.json', flow([...base, '--built-by', 'prior-ai-sessions', '--assessments', plain]).stdout), '--profile', 'infodot']).stdout);
  assert.deepEqual(withDecl.headline, noDecl.headline);
  assert.deepEqual(withDecl.dimensions, noDecl.dimensions);
  assert.equal(withDecl.header.assessors[0].declaration.fresh_reviewer, true);
});
