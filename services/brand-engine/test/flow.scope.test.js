// analyze --scope (Phase 1 defect D1): the static checks can be limited to one surface of a checkout, the reports record the scope,
// and two scopes of one repository no longer inherit each other's blockers. Everything here is a synthetic checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { assertScopeUsable, inScope, parseScope, ScopeError } from '../src/analyze/scope.js';
import { FAKE_COMMIT, flow, tmp, writeText } from './_flow_helpers.js';

const REPO = ['--repo', 'example/two-surfaces', '--commit', FAKE_COMMIT, '--profile', 'infodot'];
const ROUTES = "<?php\nuse Illuminate\\Support\\Facades\\Route;\nRoute::get('/', fn () => view('home'))->name('home');\n";

/** One repository, two surfaces: Knowledge has a blocker (an <img> with no alt), Journeys is clean. */
function twoSurfaces() {
  const dir = tmp('two-surfaces-');
  writeText(join(dir, 'routes/web.php'), ROUTES);
  writeText(join(dir, 'resources/views/home.blade.php'), "<html lang=\"en\"><head><title>Home</title></head><body><h1>Home</h1>@include('knowledge.list')@include('journeys.start')</body></html>");
  writeText(join(dir, 'resources/views/knowledge/list.blade.php'), '<section><h2>Solutions</h2><img src="/a.png"></section>');
  writeText(join(dir, 'resources/views/journeys/start.blade.php'), '<section><h2>Start</h2><img src="/b.png" alt="A diagram of the first steps"></section>');
  writeText(join(dir, 'resources/css/app.css'), ':root { --bg: #ffffff; --text: #1a1a1a; }\nbody { background: var(--bg); color: var(--text); }\n');
  return dir;
}
const analysisOf = (dir, extra = []) => {
  const r = flow(['analyze', dir, ...REPO, ...extra]);
  return { ...r, analysis: r.code === 0 ? JSON.parse(r.stdout) : null };
};
const blockers = (a) => a.findings.filter((f) => f.severity === 'blocker').map((f) => `${f.check_id} ${f.location.file}`);

// ------------------------------------------------------------------ parsing and confinement
test('a scope is a list of confined path prefixes: sorted, de-duplicated, nested prefixes folded, and recorded as one label', () => {
  assert.deepEqual(parseScope('resources/views/knowledge').prefixes, ['resources/views/knowledge']);
  assert.equal(parseScope('b/c, a ,b/c/,./a').label, 'a,b/c');
  assert.equal(parseScope('resources/views,resources/views/knowledge').label, 'resources/views', 'a prefix under another one adds nothing');
  assert.equal(parseScope('resources/viewsX,resources/views').label, 'resources/views,resources/viewsX', '"resources/viewsX" is not under "resources/views"');
  assert.equal(inScope(['a/b'], 'a/b'), true);
  assert.equal(inScope(['a/b'], 'a/b/c.php'), true);
  assert.equal(inScope(['a/b'], 'a/bc.php'), false, 'a prefix is a path prefix, not a string prefix');
  assert.equal(inScope([], 'anything'), true);
});

test('a scope that is empty, absolute, outside the checkout, a glob or too big is refused with a reason', () => {
  const bad = {
    '': /at least one path prefix/,
    ' , ': /empty path prefix/,
    '/etc': /relative to the checkout/,
    'C:/x': /relative to the checkout/,
    '../outside': /may not contain "\.\."/,
    'a/../../b': /may not contain "\.\."/,
    'a\\b': /"\/" separators/,
    'resources/**': /not globs/,
    'a/*.php': /not globs/,
    '.': /names no path/,
    './': /names no path/,
    [`a${'\0'}b`]: /NUL/,
  };
  for (const [value, re] of Object.entries(bad)) assert.throws(() => parseScope(value), (e) => e instanceof ScopeError && re.test(e.message), JSON.stringify(value));
  assert.throws(() => parseScope(Array.from({ length: 21 }, (_, i) => `d${i}`).join(',')), /more than 20/);
  assert.throws(() => parseScope(Array.from({ length: 10 }, (_, i) => `${'x'.repeat(40)}${i}`).join(',')), /longer than 300 characters/);
});

test('assertScopeUsable: a prefix must hold a readable file, and a symlink that leaves the checkout is refused', () => {
  const dir = realpathSync(twoSurfaces()); // the analyzer resolves the root once; so does this test
  const outside = tmp('outside-');
  writeText(join(outside, 'x.blade.php'), '<img src="x">');
  symlinkSync(outside, join(dir, 'resources/views/linked'));
  const listed = ['resources/views/knowledge/list.blade.php'];
  assert.doesNotThrow(() => assertScopeUsable(['resources/views/knowledge'], dir, listed));
  assert.throws(() => assertScopeUsable(['nothing/here'], dir, listed), /matches no file or directory/);
  assert.throws(() => assertScopeUsable(['resources/views/linked'], dir, listed), /resolves outside the checkout/);
  mkdirSync(join(dir, 'empty'));
  assert.throws(() => assertScopeUsable(['empty'], dir, listed), /holds no file the engine can read/);
});

// ------------------------------------------------------------------ the CLI
test('analyze --scope: each surface of one repository gets its own findings and the scope is recorded in the analysis', () => {
  const dir = twoSurfaces();
  const whole = analysisOf(dir);
  assert.equal(whole.code, 0, whole.stderr);
  assert.deepEqual(blockers(whole.analysis), ['d8.labels_alt_lang resources/views/knowledge/list.blade.php']);
  assert.equal(whole.analysis.input.scope, undefined, 'no scope: nothing recorded');

  const knowledge = analysisOf(dir, ['--scope', 'resources/views/knowledge']);
  const journeys = analysisOf(dir, ['--scope', 'resources/views/journeys']);
  assert.equal(knowledge.code, 0, knowledge.stderr);
  assert.equal(journeys.code, 0, journeys.stderr);
  assert.equal(knowledge.analysis.input.scope, 'resources/views/knowledge');
  assert.equal(journeys.analysis.input.scope, 'resources/views/journeys');
  assert.deepEqual(blockers(knowledge.analysis), ['d8.labels_alt_lang resources/views/knowledge/list.blade.php']);
  assert.deepEqual(blockers(journeys.analysis), [], 'the Journeys surface does not inherit the Knowledge blocker');
  const alt = (a) => a.evidence.find((e) => e.check_id === 'd8.labels_alt_lang').value;
  assert.ok(alt(knowledge.analysis) < alt(journeys.analysis), 'and its static evidence is its own');
  assert.notEqual(knowledge.stdout, journeys.stdout);
});

test('analyze --scope: the order and spelling of the prefixes do not change the bytes, and an unscoped run is unchanged', () => {
  const dir = twoSurfaces();
  const a = analysisOf(dir, ['--scope', 'resources/views/journeys,resources/css']);
  const b = analysisOf(dir, ['--scope', './resources/css/, resources/views/journeys']);
  assert.equal(a.stdout, b.stdout);
  assert.equal(a.analysis.input.scope, 'resources/css,resources/views/journeys');
  const plain = analysisOf(dir);
  assert.equal(plain.stdout, analysisOf(dir).stdout);
});

test('analyze --scope: a bad scope is invalid input (exit 2) and the message says why; nothing is written', () => {
  const dir = twoSurfaces();
  for (const [scope, re] of [['nothing/here', /matches no file or directory/], ['../x', /may not contain/], ['/etc', /relative to the checkout/], ['resources/*', /not globs/], ['', /needs a value|at least one/]]) {
    const r = flow(['analyze', dir, ...REPO, '--scope', scope]);
    assert.equal(r.code, 2, scope);
    assert.match(r.stderr, re, scope);
    assert.equal(r.stdout, '');
  }
  const outside = tmp('outside-');
  writeText(join(outside, 'x.blade.php'), '<img src="x">');
  symlinkSync(outside, join(dir, 'resources/views/linked'));
  const escaped = flow(['analyze', dir, ...REPO, '--scope', 'resources/views/linked']);
  assert.equal(escaped.code, 2);
  assert.match(escaped.stderr, /resolves outside the checkout/);
  assert.equal(flow(['analyze', dir, ...REPO, '--scope', 'a', '--scope', 'b']).code, 2, 'given twice');
});

test('analyze --scope: the summary names the scope, and the scope travels to the evidence file and the score report', () => {
  const dir = twoSurfaces();
  const out = tmp('scope-out-');
  const r = flow(['analyze', dir, ...REPO, '--scope', 'resources/views/knowledge', '--out', out]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /- Scope: resources\/views\/knowledge/);
  const whole = flow(['analyze', dir, ...REPO, '--out', tmp('scope-out2-')]);
  assert.match(whole.stdout, /- Scope: the whole checkout/);
  const evPath = join(out, 'evidence.json');
  const e = flow(['evidence', 'assemble', '--analysis', join(out, 'analysis.json'), '--built-by', 'builder', '--generated-at', '2026-10-23T12:00:00Z', '-o', evPath]);
  assert.equal(e.code, 0, e.stderr);
  const s = flow(['score', '--evidence', evPath, '--profile', 'infodot']);
  assert.equal(s.code, 0, s.stderr);
  assert.equal(JSON.parse(s.stdout).header.input.scope, 'resources/views/knowledge');
  assert.equal(JSON.parse(s.stdout).blockers.length, 1);
  const journeys = tmp('scope-j-');
  flow(['analyze', dir, ...REPO, '--scope', 'resources/views/journeys', '--out', journeys]);
  flow(['evidence', 'assemble', '--analysis', join(journeys, 'analysis.json'), '--built-by', 'builder', '--generated-at', '2026-10-23T12:00:00Z', '-o', join(journeys, 'evidence.json')]);
  const js = JSON.parse(flow(['score', '--evidence', join(journeys, 'evidence.json'), '--profile', 'infodot']).stdout);
  assert.equal(js.blockers.length, 0, 'the other surface\'s blocker did not block this report');
  assert.equal(js.state === 'not_ready', true);
});

test('verify: the baseline\'s scope is kept by default, and a different scope is refused instead of read as a fix', () => {
  const dir = twoSurfaces();
  const out = tmp('verify-scope-');
  assert.equal(flow(['analyze', dir, ...REPO, '--scope', 'resources/views/knowledge', '--out', out]).code, 0);
  const before = join(out, 'analysis.json');
  const same = flow(['verify', '--before', before, dir, ...REPO]);
  assert.equal(same.code, 0, same.stderr);
  assert.equal(JSON.parse(same.stdout).verdict, 'no_change');
  const explicit = flow(['verify', '--before', before, dir, ...REPO, '--scope', ' resources/views/knowledge/ ']);
  assert.equal(explicit.code, 0, explicit.stderr);
  const other = flow(['verify', '--before', before, dir, ...REPO, '--scope', 'resources/views/journeys']);
  assert.equal(other.code, 3);
  assert.match(other.stderr, /differs from the baseline's scope \(resources\/views\/knowledge\)/);
  // a baseline made without a scope cannot be verified with one
  const whole = tmp('verify-whole-');
  flow(['analyze', dir, ...REPO, '--out', whole]);
  const widened = flow(['verify', '--before', join(whole, 'analysis.json'), dir, ...REPO, '--scope', 'resources/views/knowledge']);
  assert.equal(widened.code, 3);
  assert.match(widened.stderr, /the whole checkout/);
});

test('the checks are given the scope: ctx.scope (a frozen list of prefixes) reaches a check module in its worker', () => {
  const dir = twoSurfaces();
  const checks = join(import.meta.dirname, 'fixtures', 'scope-checks');
  const scoped = analysisOf(dir, ['--scope', 'resources/views/journeys,resources/css', '--checks-dir', checks]);
  assert.equal(scoped.code, 0, scoped.stderr);
  const detail = scoped.analysis.evidence.find((e) => e.check_id === 'd3.nav_depth').detail;
  assert.match(detail, /^scope=\["resources\/css","resources\/views\/journeys"\] frozen=true listed=\d+$/);
  const none = analysisOf(dir, ['--checks-dir', checks]);
  assert.match(none.analysis.evidence.find((e) => e.check_id === 'd3.nav_depth').detail, /^scope=\[\] frozen=true/);
});
