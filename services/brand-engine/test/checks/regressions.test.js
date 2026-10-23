// Regression tests for the Phase 1 findings: each one reproduces a reported false positive, a vacuous pass or a
// scope defect from a small synthetic checkout, and pins the behaviour that replaced it. The checkouts are made up;
// none of them is a copy of any product.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFILE, brief, loadChecks, reasonOf, runOn, substantive, tmpRepo } from './_helpers.js';

const checks = await loadChecks();
const run = (id, files, profile = PROFILE, extra = {}) => runOn(checks, id, tmpRepo(files), profile, extra);
const ids = (r) => substantive(r).map((f) => f.id.split('.')[2]);
const WEB = "<?php\nuse Illuminate\\Support\\Facades\\Route;\nRoute::get('/', fn () => view('home'))->name('home');\n";
const WORDS = (n) => Array.from({ length: n }, (_, i) => `clause${i} of the notice`).join(' ');

// ---- F1: Route::has() guards ---------------------------------------------------------------------------------------

test('F1 dead links: a link inside @if (Route::has(...)) for the route it names is not dead', () => {
  const guarded = run('d5.dead_links', {
    'routes/web.php': WEB,
    'resources/views/home.blade.php': [
      '<footer>',
      "@if (Route::has('contact'))",
      '  <a href="{{ route(\'contact\') }}">Contact</a>',
      '@endif',
      '<a href="{{ route(\'home\') }}">Home</a>',
      '</footer>',
    ].join('\n'),
  });
  assert.equal(guarded.status, 'measured');
  assert.deepEqual(substantive(guarded), [], 'the guarded link is not a finding');
  assert.equal(guarded.evidence[0].result, 1);
  assert.match(guarded.evidence[0].detail, /1 link\(s\) sit inside a Route::has\(\) guard/);
});

test('F1 dead links: the guard is read precisely, so a negated, or-ed, other-named or else-branch link is still dead', () => {
  const r = run('d5.dead_links', {
    'routes/web.php': WEB,
    'resources/views/home.blade.php': [
      "@if (! Route::has('a'))", '  <a href="{{ route(\'a\') }}">negated</a>', '@endif',
      "@if (Route::has('b') || $force)", '  <a href="{{ route(\'b\') }}">or-ed</a>', '@endif',
      "@if (Route::has('other'))", '  <a href="{{ route(\'c\') }}">other name</a>', '@endif',
      "@if (Route::has('d'))", '  x', '@else', '  <a href="{{ route(\'d\') }}">else branch</a>', '@endif',
      "@if (Auth::check() && Route::has('e'))", '  <a href="{{ route(\'e\') }}">and-ed</a>', '@endif',
      "<a href=\"{{ route('f') }}\">after the block</a>",
    ].join('\n'),
  });
  assert.deepEqual(brief(r).map((x) => x.replace('resources/views/home.blade.php:', 'L')), [
    'dead-internal-link major L2', 'dead-internal-link major L5', 'dead-internal-link major L8', 'dead-internal-link major L13', 'dead-internal-link major L18',
  ], 'a, b, c, d (else) and f are dead; e (and-ed with the guard) is not');
  assert.match(r.findings[0].message, /route\('a'\)/);
});

test('F1 dead links: an @elseif branch guards its own route, and nested blocks close in order', () => {
  const r = run('d5.dead_links', {
    'routes/web.php': WEB,
    'resources/views/home.blade.php': [
      '@if ($x)', "  @if (Route::has('inner'))", '    <a href="{{ route(\'inner\') }}">i</a>', '  @endif', "  <a href=\"{{ route('outer') }}\">outside the inner guard</a>", '@elseif (Route::has(\'second\'))',
      '  <a href="{{ route(\'second\') }}">s</a>', '@endif',
    ].join('\n'),
  });
  assert.deepEqual(brief(r).map((x) => x.replace('resources/views/home.blade.php:', 'L')), ['dead-internal-link major L5']);
});

// ---- F2: pages the framework registers (Jetstream terms and privacy) --------------------------------------------------

const JETSTREAM = {
  'composer.json': JSON.stringify({ require: { 'laravel/jetstream': '^5.0' } }),
  'config/jetstream.php': "<?php\nreturn [\n    'features' => [\n        // Features::termsAndPrivacyPolicy(),\n        Features::termsAndPrivacyPolicy(),\n        Features::profilePhotos(),\n    ],\n];\n",
  'resources/markdown/terms.md': `# Terms\n\n${WORDS(40)}\n`,
  'resources/markdown/policy.md': `# Privacy policy\n\n${WORDS(40)}\n`,
  'routes/web.php': WEB,
  'resources/views/layouts/app.blade.php': '<footer><a href="{{ route(\'terms.show\') }}">Terms</a> <a href="{{ route(\'policy.show\') }}">Privacy</a></footer>',
  'resources/views/home.blade.php': '<a href="{{ route(\'terms.show\') }}">Terms</a> <a href="/privacy-policy">Privacy</a>',
};

test('F2 privacy and terms: Jetstream registers /terms-of-service and /privacy-policy from resources/markdown, and that counts', () => {
  const r = run('d6.privacy_terms_present', JETSTREAM);
  assert.equal(r.status, 'measured');
  assert.deepEqual(substantive(r), [], 'present, real (enough words) and linked: nothing to report');
  assert.equal(r.evidence[0].result, 1);
});

test('F2 dead links: the framework pages resolve by name and by path, and the detail says where they came from', () => {
  const r = run('d5.dead_links', JETSTREAM);
  assert.deepEqual(substantive(r), []);
  assert.equal(r.evidence[0].result, 1);
  assert.match(r.evidence[0].detail, /plus 2 page\(s\) the framework registers/);
});

test('F2 privacy and terms: the pages are judged on their markdown, and a missing or stub file is reported', () => {
  const stub = run('d6.privacy_terms_present', { ...JETSTREAM, 'resources/markdown/policy.md': '# Privacy policy\n\nTODO write this.\n' });
  assert.deepEqual(ids(stub), ['privacy-placeholder']);
  assert.equal(stub.findings.find((f) => f.id.includes('privacy-placeholder')).location.file, 'resources/markdown/policy.md');
  const withoutTerms = Object.fromEntries(Object.entries(JETSTREAM).filter(([k]) => k !== 'resources/markdown/terms.md'));
  const gone = run('d6.privacy_terms_present', withoutTerms);
  assert.deepEqual(ids(gone), ['terms-missing']);
  assert.match(gone.findings[0].message, /resources\/markdown\/terms\.md does not exist/);
});

test('F2 a published terms view whose body is the variable {!! $terms !!} is judged on the markdown, not left unjudged', () => {
  const r = run('d6.privacy_terms_present', {
    ...JETSTREAM,
    'resources/views/terms.blade.php': '<x-guest-layout>{!! $terms !!}</x-guest-layout>',
    'resources/views/policy.blade.php': '<x-guest-layout>{!! $policy !!}</x-guest-layout>',
  });
  assert.equal(r.evidence[0].result, 1);
  assert.doesNotMatch(r.evidence[0].detail, /not judged/);
});

test('F2 when config/jetstream.php does not enable the feature, nothing is registered and a link to the page is still dead', () => {
  const off = { ...JETSTREAM, 'config/jetstream.php': "<?php\nreturn ['features' => [\n // Features::termsAndPrivacyPolicy(),\n Features::profilePhotos(),\n]];\n" };
  const privacy = run('d6.privacy_terms_present', off);
  assert.deepEqual(ids(privacy).sort(), ['privacy-missing', 'terms-missing']);
  const links = run('d5.dead_links', { ...off, 'resources/views/home.blade.php': '<a href="/privacy-policy">Privacy</a><a href="/">Home</a>' });
  assert.deepEqual(ids(links), ['dead-internal-link']);
});

// ---- F4: unmounted templates are not WCAG blockers ---------------------------------------------------------------------

const ORPHAN = {
  'routes/web.php': WEB,
  'resources/views/home.blade.php': '<!doctype html><html lang="en"><head><title>Home</title></head><body><h1>Home</h1></body></html>',
  'app/Livewire/SolutionList.php': "<?php\nnamespace App\\Livewire;\nclass SolutionList extends \\Livewire\\Component\n{\n    public function render()\n    {\n        return view('livewire.solution-list');\n    }\n}\n",
  'resources/views/livewire/solution-list.blade.php': '<div>\n  <img src="https://images.example/random.jpg">\n</div>',
  'composer.json': JSON.stringify({ require: { 'livewire/livewire': '^3.0' } }),
};
const altFindings = (r) => r.findings.filter((f) => f.id.includes('img-alt-missing'));

test('F4 an <img> with no alt in a Livewire view that nothing mounts is a major with a note, never a blocker', () => {
  const r = run('d8.labels_alt_lang', ORPHAN);
  const [f] = altFindings(r);
  assert.equal(altFindings(r).length, 1);
  assert.equal(f.severity, 'major');
  assert.equal(f.kind, undefined, 'a major carries no kind, so it can never become a score blocker');
  assert.equal(f.wcag_criterion, '1.1.1', 'the criterion stays for information');
  assert.match(f.message, /Downgraded to major: this template is not mounted/);
  assert.match(r.evidence[0].detail, /1 would-be blocker\(s\) sit in templates nothing mounts/);
  assert.equal(r.evidence[0].result, 0.5, 'the markup still counts against the share (the image fails, the home document passes): only the severity changes');
});

test('F4 the same view is a blocker as soon as anything mounts it: tag, directive, route, include or component', () => {
  const mounts = {
    'a <livewire:...> tag': { 'resources/views/home.blade.php': '<html lang="en"><head><title>t</title></head><body><livewire:solution-list /></body></html>' },
    'an @livewire directive': { 'resources/views/home.blade.php': "<html lang=\"en\"><head><title>t</title></head><body>@livewire('solution-list')</body></html>" },
    'a route to the class': { 'routes/web.php': `${WEB}Route::get('/solutions', \\App\\Livewire\\SolutionList::class);\n` },
    'a nested tag name': { 'resources/views/home.blade.php': '<html lang="en"><head><title>t</title></head><body><livewire:solution-list /></body></html>' },
  };
  for (const [what, files] of Object.entries(mounts)) {
    const r = run('d8.labels_alt_lang', { ...ORPHAN, ...files });
    assert.equal(altFindings(r)[0].severity, 'blocker', what);
    assert.equal(altFindings(r)[0].kind, 'wcag_failure', what);
  }
  const included = run('d8.labels_alt_lang', {
    'routes/web.php': WEB,
    'resources/views/home.blade.php': "<html lang=\"en\"><head><title>t</title></head><body>@include('partials.card')<x-panel /></body></html>",
    'resources/views/partials/card.blade.php': '<img src="a.png">',
    'resources/views/components/panel.blade.php': '<img src="b.png">',
  });
  assert.deepEqual(altFindings(included).map((f) => f.severity), ['blocker', 'blocker'], 'an @include and an anonymous <x-panel> mount their views');
  const controller = run('d8.labels_alt_lang', {
    'routes/web.php': WEB,
    'app/Http/Controllers/PageController.php': "<?php\nclass PageController { public function show() { return view('pages.about'); } }\n",
    'resources/views/pages/about.blade.php': '<img src="c.png">',
  });
  assert.equal(altFindings(controller)[0].severity, 'blocker');
  const class_ = run('d8.labels_alt_lang', {
    'routes/web.php': WEB,
    'resources/views/home.blade.php': '<html lang="en"><head><title>t</title></head><body><x-alert-box /></body></html>',
    'app/View/Components/AlertBox.php': "<?php\nclass AlertBox { public function render() { return view('components.alert-box'); } }\n",
    'resources/views/components/alert-box.blade.php': '<img src="d.png">',
  });
  assert.equal(altFindings(class_)[0].severity, 'blocker', 'a class-based component mounted by its tag');
});

test('F4 a view that only an unmounted template references stays unmounted, and a mounted chain reaches its end', () => {
  const r = run('d8.labels_alt_lang', {
    ...ORPHAN,
    'resources/views/livewire/solution-list.blade.php': "<div>@include('partials.deep')</div>",
    'resources/views/partials/deep.blade.php': '<img src="x.png">',
  });
  assert.equal(altFindings(r)[0].severity, 'major', 'deep is reached only from the orphan');
});

test('F4 reachability that cannot be established keeps the blocker: dynamic view names, a dynamic prefix, no PHP at all', () => {
  const dynamicAll = run('d8.labels_alt_lang', { ...ORPHAN, 'app/Http/Controllers/PageController.php': "<?php\nclass PageController { public function show($name) { return view($name); } }\n" });
  assert.equal(altFindings(dynamicAll)[0].severity, 'blocker', 'view($name) could render anything');
  const prefix = run('d8.labels_alt_lang', { ...ORPHAN, 'app/Http/Controllers/PageController.php': "<?php\nclass PageController { public function show($n) { return view('livewire.' . $n); } }\n" });
  assert.equal(altFindings(prefix)[0].severity, 'blocker', 'view("livewire." . $n) could render this one');
  const otherPrefix = run('d8.labels_alt_lang', { ...ORPHAN, 'app/Http/Controllers/PageController.php': "<?php\nclass PageController { public function show($n) { return view('pages.' . $n); } }\n" });
  assert.equal(altFindings(otherPrefix)[0].severity, 'major', 'a prefix that does not cover it changes nothing');
  const noPhp = run('d8.labels_alt_lang', { 'resources/views/orphan.blade.php': '<img src="a.png">' });
  assert.equal(altFindings(noPhp)[0].severity, 'blocker', 'views with no PHP to render them: nothing can be said, so it stays a blocker');
  // a component chosen at run time can only name a component that is spelled somewhere
  const dynamicTag = { ...ORPHAN, 'resources/views/home.blade.php': '<html lang="en"><head><title>t</title></head><body><livewire:is :component="$c" /></body></html>' };
  assert.equal(altFindings(run('d8.labels_alt_lang', dynamicTag))[0].severity, 'major', '<livewire:is> alone names nothing');
  const spelled = run('d8.labels_alt_lang', { ...dynamicTag, 'app/Http/Controllers/PageController.php': "<?php\nclass PageController { const PARTS = ['solution-list', 'search']; }\n" });
  assert.equal(altFindings(spelled)[0].severity, 'blocker', 'the name is spelled in code, so the dynamic mount may be it');
  const dynamicDirective = run('d8.labels_alt_lang', { ...ORPHAN, 'resources/views/home.blade.php': "<html lang=\"en\"><head><title>t</title></head><body>@php $parts = ['solution-list']; @endphp @livewire($part)</body></html>" });
  assert.equal(altFindings(dynamicDirective)[0].severity, 'blocker', 'a name spelled in the template itself counts too');
});

test('F4 framework conventions are never called unmounted, and every blocker rule of the check is downgraded the same way', () => {
  const conventions = run('d8.labels_alt_lang', {
    'routes/web.php': WEB,
    'composer.json': JSON.stringify({ require: { 'laravel/jetstream': '^5.0' } }),
    'resources/views/errors/404.blade.php': '<img src="a.png">',
    'resources/views/auth/login.blade.php': '<img src="b.png">',
  });
  assert.deepEqual(altFindings(conventions).map((f) => f.severity), ['blocker', 'blocker'], 'errors.* (resolved by the exception handler) and auth.* (resolved by Jetstream)');
  const rules = run('d8.labels_alt_lang', {
    'routes/web.php': WEB,
    'resources/views/orphan.blade.php': '<html><head><title></title><meta name="viewport" content="width=device-width, user-scalable=no"></head><body><img src="a.png"><input type="image" src="b.png"></body></html>',
  });
  const blockerRules = substantive(rules).filter((f) => ['html-lang-missing', 'title-empty', 'viewport-zoom-disabled', 'img-alt-missing', 'input-image-alt'].some((n) => f.id.includes(n)));
  assert.equal(blockerRules.length, 5);
  assert.ok(blockerRules.every((f) => f.severity === 'major' && f.kind === undefined), 'all five blocker rules');
});

// ---- F3: a focus ring is judged on the ground it sits on -------------------------------------------------------------

const css = (body) => ({ 'resources/css/app.css': body });
const PAGE = ':root { --bg: #ffffff; --panel: #f4f4f4; }\n';

test('F3 focus: a ring inside a container with a dark background is judged against that container, not the light page grounds', () => {
  // old behaviour: #cccccc against --bg and --panel = 2 majors. The ring really sits on the #111111 bar (about 11:1).
  const r = run('d8.token_pair_contrast', css(`${PAGE}.top { background: #111111; }\n.top .search input:focus { outline: 2px solid #cccccc; }`));
  assert.deepEqual(substantive(r), []);
  assert.equal(r.evidence[0].result, 1);
});

test('F3 focus: the nearest ancestor that declares a background decides, and a ring that fails on it is still found', () => {
  const light = run('d8.token_pair_contrast', css(`${PAGE}.card { background: #ffffff; }\n.card input:focus-visible { outline: 2px solid #cccccc; }`));
  assert.deepEqual(brief(light), ['low-contrast major resources/css/app.css:3']);
  assert.match(light.findings[0].message, /below 3:1 for #cccccc on #ffffff.*\.card input:focus-visible/);
  assert.equal(light.findings[0].kind, undefined);
  const nearest = run('d8.token_pair_contrast', css(`${PAGE}.a { background: #ffffff; }\n.a .b { background: #000000; }\n.a .b input:focus { outline: 2px solid #cccccc; }`));
  assert.deepEqual(substantive(nearest), [], '.a .b (black) is nearer than .a (white)');
});

test('F3 focus: an outline is drawn outside the box, so the element\'s own background is not behind it; a negative offset draws it inside', () => {
  // outside, a particular element, no ancestor declares a ground: the page ground is not assumed, the ring is not measured
  const outside = run('d8.token_pair_contrast', css(`${PAGE}.pill { background: #111111; }\n.pill:focus-within { outline: 2px solid #cccccc; }`));
  assert.equal(outside.status, 'not_measured');
  assert.match(reasonOf(outside), /1 focus ring\(s\) of particular elements have no background declared behind them and were not measured/);
  // inside: the ring is on the element's own #111111
  const inset = run('d8.token_pair_contrast', css(`${PAGE}.pill { background: #111111; }\n.pill:focus-within { outline: 2px solid #cccccc; outline-offset: -2px; }`));
  assert.deepEqual(substantive(inset), []);
  assert.equal(inset.status, 'measured');
  const insetOwn = run('d8.token_pair_contrast', css(`${PAGE}.btn:focus { background: #ffffff; outline: 2px solid #cccccc; outline-offset: -2px; }`));
  assert.deepEqual(brief(insetOwn), ['low-contrast major resources/css/app.css:2']);
});

test('F3 focus: a ring that belongs to no particular element (bare :focus-visible, a tag) is judged against all declared grounds, as before', () => {
  assert.equal(run('d8.token_pair_contrast', css(`${PAGE}a:focus-visible { outline: 2px solid #eeeeee; }`)).evidence[0].result, 0);
  assert.equal(run('d8.token_pair_contrast', css(`${PAGE}:focus-visible { outline: 2px solid #eeeeee; }`)).evidence[0].result, 0);
  // a particular element beside a generic one: only the particular one is left out
  const both = run('d8.token_pair_contrast', css(`${PAGE}:focus-visible { outline: 2px solid #595959; }\n.x:focus { outline: 2px solid #eeeeee; }`));
  assert.equal(both.evidence[0].result, 1);
  assert.match(both.evidence[0].detail, /1 focus ring\(s\) of particular elements not measured/);
});

test('F3 focus: a ground that cannot be read (a gradient) leaves the pair undetermined, never a pass or a failure', () => {
  const r = run('d8.token_pair_contrast', css(`${PAGE}.hero { background: linear-gradient(#000000, #ffffff); }\n.hero a:focus-visible { outline: 2px solid #888888; }`));
  assert.equal(r.status, 'not_measured');
  assert.match(reasonOf(r), /none resolved to two opaque colours/);
});

test('F3 focus: a generic ring with no declared background is judged only if every ground agrees; a mixed answer is not measured', () => {
  // #595959 is 7:1 on white and 6.1:1 on #f4f4f4: every ground passes
  assert.equal(run('d8.token_pair_contrast', css(`${PAGE}a:focus-visible { outline: 2px solid #595959; }`)).evidence[0].result, 1);
  // #959595 is 2.99:1 on white (fails) and 3.2:1 on #444444 (passes): where the ring is drawn decides, so neither is claimed
  const mixed = run('d8.token_pair_contrast', css(':root { --bg: #ffffff; --raised: #444444; }\n:focus-visible { outline: 2px solid #959595; }\n.x { color: #000000; background: #ffffff; }'));
  assert.deepEqual(substantive(mixed).filter((f) => /focus/.test(f.message)), []);
  assert.equal(mixed.status, 'measured');
  assert.match(mixed.evidence[0].detail, /1 focus ring\(s\)\/theme\(s\) not measured because no background is declared behind the ring and the declared grounds disagree/);
  // fails on every ground: a failure whatever the page looks like
  const every = run('d8.token_pair_contrast', css(`${PAGE}a:focus-visible { outline: 2px solid #eeeeee; }`));
  assert.equal(every.evidence[0].result, 0);
  assert.match(every.findings[0].message, /fails on every ground the stylesheet declares/);
});

test('F3 focus: a ring token paired by name with the grounds follows the same rule (all pass, all fail, or not measured)', () => {
  const fail = run('d8.token_pair_contrast', css(':root { --bg: #ffffff; --panel: #f4f4f4; --focus: #cccccc; }'));
  assert.equal(fail.findings.length, 2, 'fails on both grounds: both reported, as before');
  const mixed = run('d8.token_pair_contrast', css(':root { --bg: #ffffff; --raised: #444444; --focus: #888888; }'));
  assert.equal(mixed.status, 'not_measured', 'passes on one ground and fails on the other: the token alone does not say which');
});

// ---- V1: a pass at 1.00 for an empty set is not a pass ------------------------------------------------------------------

test('V1 d1: a profile with no banned phrases leaves the copy lint not measured, not 1.00', () => {
  const none = { ...PROFILE, language: { ...PROFILE.language, banned_phrases: [] } };
  const r = run('d1.copy_profile_language_lint', { 'resources/views/page.blade.php': '<p>Plain words about a plain product.</p>' }, none);
  assert.equal(r.status, 'not_measured');
  assert.deepEqual(r.evidence, []);
  assert.match(reasonOf(r), /lists no banned phrases/);
  const withPhrases = run('d1.copy_profile_language_lint', { 'resources/views/page.blade.php': '<p>Plain words about a plain product.</p>' });
  assert.equal(withPhrases.evidence[0].result, 1, 'a real list that nothing matched is a real 1.00');
});

test('V1 d6.claim_lint: no claim-bearing string means no share to measure; one claim makes it measured again', () => {
  const clean = run('d6.claim_lint', { 'resources/views/page.blade.php': '<h1>Welcome</h1><p>Sign in to see your reports.</p>' });
  assert.equal(clean.status, 'not_measured');
  assert.deepEqual(clean.evidence, []);
  assert.match(reasonOf(clean), /none carries a claim or figure the patterns know/);
  const one = run('d6.claim_lint', { 'resources/views/page.blade.php': '<p>Trusted by 5,000 teams</p><p>Sign in</p>' });
  assert.equal(one.status, 'measured');
  assert.equal(one.evidence[0].result, 0);
});

test('V1 d4.reduced_motion and d8.focus_visible: nothing declared is an empty set, not a pass', () => {
  assert.equal(run('d4.reduced_motion', css('.a { color: red; }')).status, 'not_measured');
  assert.equal(run('d8.focus_visible', css('.a { color: red; }')).status, 'not_measured');
  assert.equal(run('d8.focus_visible', css('.a { color: red; }')).evidence.length, 0);
  assert.equal(run('d4.reduced_motion', css('.a { transition: color 0.2s; }\n@media (prefers-reduced-motion: reduce) { * { transition-duration: 0.01ms !important; } }')).evidence[0].result, 1, 'a covered declaration is a real 1.00');
  assert.equal(run('d8.focus_visible', css('a:focus { outline: none; outline-offset: 0; box-shadow: 0 0 0 2px #000; }')).evidence[0].result, 1, 'a removal with a replacement is a real 1.00');
});

// ---- D1: --scope at the check level (the CLI is covered in flow.scope.test.js) ---------------------------------------------

const TWO_SURFACES = {
  'routes/web.php': WEB,
  'resources/views/knowledge/list.blade.php': '<img src="a.png">\n<a href="{{ route(\'nowhere\') }}">x</a>',
  'resources/views/journeys/start.blade.php': '<h1>Start</h1><img src="b.png" alt="A diagram">',
  'resources/views/home.blade.php': "@include('knowledge.list')@include('journeys.start')",
  'resources/css/app.css': ':root { --bg: #fff; }',
};

test('D1 scope: the checks list only the files under the scope, so two surfaces of one repository do not share findings', () => {
  const root = tmpRepo(TWO_SURFACES);
  const knowledge = runOn(checks, 'd8.labels_alt_lang', root, PROFILE, { scope: ['resources/views/knowledge'] });
  assert.deepEqual(brief(knowledge), ['img-alt-missing blocker resources/views/knowledge/list.blade.php:1']);
  const journeys = runOn(checks, 'd8.labels_alt_lang', root, PROFILE, { scope: ['resources/views/journeys'] });
  assert.deepEqual(substantive(journeys), [], 'the other surface\'s blocker is not inherited');
  assert.equal(journeys.evidence[0].result, 1);
  const both = runOn(checks, 'd8.labels_alt_lang', root, PROFILE, { scope: ['resources/views/journeys', 'resources/views/knowledge'] });
  assert.equal(substantive(both).length, 1);
  const whole = runOn(checks, 'd8.labels_alt_lang', root, PROFILE);
  assert.equal(substantive(whole).length, 1, 'no scope: the whole checkout, as before');
});

test('D1 scope: support files outside the scope are still read, so a link is resolved against the application\'s routes', () => {
  const root = tmpRepo(TWO_SURFACES);
  const r = runOn(checks, 'd5.dead_links', root, PROFILE, { scope: ['resources/views/knowledge'] });
  assert.deepEqual(brief(r), ['dead-internal-link major resources/views/knowledge/list.blade.php:2']);
  const ok = runOn(checks, 'd5.dead_links', tmpRepo({ ...TWO_SURFACES, 'resources/views/knowledge/list.blade.php': '<a href="{{ route(\'home\') }}">h</a>' }), PROFILE, { scope: ['resources/views/knowledge'] });
  assert.equal(ok.evidence[0].result, 1, 'route("home") is defined in routes/web.php, outside the scope');
});

test('D1 scope: a scope with no UI file under it makes the UI checks not applicable instead of reading the rest of the repository', () => {
  const r = runOn(checks, 'd8.labels_alt_lang', tmpRepo(TWO_SURFACES), PROFILE, { scope: ['routes'] });
  assert.equal(r.status, 'not_applicable');
});

test('D1 scope: reachability looks at the whole checkout, so an in-scope view mounted from outside the scope is a blocker', () => {
  const root = tmpRepo({
    'routes/web.php': WEB,
    'resources/views/home.blade.php': "<html lang=\"en\"><head><title>t</title></head><body>@include('knowledge.list')</body></html>",
    'resources/views/knowledge/list.blade.php': '<img src="a.png">',
  });
  const r = runOn(checks, 'd8.labels_alt_lang', root, PROFILE, { scope: ['resources/views/knowledge'] });
  assert.equal(r.findings[0].severity, 'blocker');
});
