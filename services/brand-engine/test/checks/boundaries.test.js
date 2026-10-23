// Boundaries and honesty: the numbers either side of each threshold, the cases a check must leave alone,
// and "not measured" instead of a pass whenever the evidence is missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFILE, brief, loadChecks, reasonOf, runOn, substantive, tmpRepo } from './_helpers.js';

const checks = await loadChecks();
const run = (id, files, profile = PROFILE, extra) => runOn(checks, id, tmpRepo(files), profile, extra);
const css = (body) => ({ 'resources/css/app.css': body });
const view = (body, name = 'resources/views/page.blade.php') => ({ [name]: body });

// ---- contrast ---------------------------------------------------------------------------------------

test('contrast: 4.54:1 passes and 4.48:1 fails at the 4.5 threshold (text)', () => {
  const pass = run('d8.token_pair_contrast', css('.a { color: #767676; background: #ffffff; }'));
  assert.equal(pass.status, 'measured');
  assert.equal(pass.evidence[0].result, 1);
  assert.deepEqual(pass.findings, []);
  const fail = run('d8.token_pair_contrast', css('.a { color: #777777; background: #ffffff; }'));
  assert.equal(fail.evidence[0].result, 0);
  assert.deepEqual(brief(fail), ['low-contrast blocker resources/css/app.css:1']);
  assert.match(fail.findings[0].message, /4\.47:1.*below 4\.5:1.*#777777.*#ffffff/, 'the exact ratio is shown, truncated, never rounded up');
});

test('contrast: large text is held to 3:1, 3.03 passes and 2.99 fails', () => {
  const big = (fg) => css(`.h { color: ${fg}; background: #ffffff; font-size: 24px; }`);
  assert.equal(run('d8.token_pair_contrast', big('#949494')).evidence[0].result, 1);
  const fail = run('d8.token_pair_contrast', big('#959595'));
  assert.equal(fail.evidence[0].result, 0);
  assert.match(fail.findings[0].message, /2\.99:1.*below 3:1/);
  // the same grey at normal size fails the stricter threshold
  assert.equal(run('d8.token_pair_contrast', css('.h { color: #949494; background: #fff; font-size: 16px; }')).evidence[0].result, 0);
  // 18.66px needs bold to count as large
  assert.equal(run('d8.token_pair_contrast', css('.h { color: #949494; background: #fff; font-size: 19px; }')).evidence[0].result, 0);
  assert.equal(run('d8.token_pair_contrast', css('.h { color: #949494; background: #fff; font-size: 19px; font-weight: 700; }')).evidence[0].result, 1);
});

test('contrast: a focus indicator is held to 3:1 against the ground tokens (WCAG 1.4.11), by token and by outline', () => {
  const base = ':root { --bg: #ffffff; --panel: #f4f4f4; --focus: #cccccc; }\n';
  const r = run('d8.token_pair_contrast', css(base));
  assert.equal(r.evidence[0].result, 0);
  assert.deepEqual(brief(r), ['low-contrast major resources/css/app.css:1', 'low-contrast major resources/css/app.css:1']);
  assert.match(r.findings[0].message, /below 3:1 for --focus \(#cccccc\)/);
  assert.equal(r.findings[0].wcag_criterion, '1.4.11');
  assert.equal(r.findings[0].kind, undefined, 'a focus pair is a heuristic: never a blocker');
  const ok = run('d8.token_pair_contrast', css(':root { --bg: #ffffff; --focus: #767676; }'));
  assert.equal(ok.evidence[0].result, 1);
  const byRule = run('d8.token_pair_contrast', css(`${base.replace('--focus: #cccccc;', '')}a:focus-visible { outline: 2px solid #dddddd; }\nb:focus { outline-color: #111111; }\nc:focus:not(:focus-visible) { outline: none; }`));
  assert.deepEqual(brief(byRule), ['low-contrast major resources/css/app.css:2', 'low-contrast major resources/css/app.css:2']);
  assert.equal(byRule.evidence[0].result, 0.5, 'the dark outline passes on both grounds, the light one fails on both');
});

test('contrast: both themes are evaluated, var() chains follow the theme, and the failing theme is named', () => {
  const r = run('d8.token_pair_contrast', css(':root { --bg: #fff; --fg: #222; --surface: var(--bg); }\n@media (prefers-color-scheme: dark) { :root { --bg: #000; --fg: #333; } }\n.a { color: var(--fg); background: var(--surface); }'));
  assert.equal(r.evidence[0].result, 0.5);
  // the declared pair (line 3) is a blocker; --fg on --bg is the same colours reached by token names (a major)
  assert.deepEqual(brief(r), ['low-contrast major resources/css/app.css:1', 'low-contrast blocker resources/css/app.css:3']);
  assert.ok(r.findings.every((f) => /dark theme/.test(f.message)), 'the light theme passes');
  assert.match(r.evidence[0].detail, /themes evaluated: light, dark/);
});

test('contrast: a theme selected by attribute or class counts, and :not([data-theme="light"]) is dark-only', () => {
  const body = ':root { --bg: #fff; --fg: #111; }\n:root[data-theme="dark"] { --bg: #111; --fg: #112; }\n.a { color: var(--fg); background: var(--bg); }';
  const r = run('d8.token_pair_contrast', css(body));
  assert.equal(r.evidence[0].result, 0.5);
  assert.match(r.findings[0].message, /dark theme/);
});

test('contrast: a translucent background is undetermined, never a pass', () => {
  const r = run('d8.token_pair_contrast', css('.a { color: #fff; background: rgba(255,255,255,0.1); }'));
  assert.equal(r.status, 'not_measured');
  assert.match(reasonOf(r), /none resolved to two opaque colours/);
});

test('contrast: a translucent foreground is composited over its background', () => {
  const r = run('d8.token_pair_contrast', css('.a { color: rgba(0,0,0,0.3); background: #ffffff; }'));
  assert.equal(r.status, 'measured');
  assert.equal(r.evidence[0].result, 0, '30% black on white is about 2.3:1');
});

test('contrast: pairs that cannot be read leave the check not_measured with a reason', () => {
  for (const files of [css('.a { color: var(--missing); background: var(--other); }'), css('.a { color: red; }'), view('<p>hi</p>')]) {
    const r = run('d8.token_pair_contrast', files);
    assert.equal(r.status, 'not_measured', JSON.stringify(Object.keys(files)));
    assert.deepEqual(r.evidence, []);
    assert.ok(reasonOf(r).length > 10);
  }
});

test('contrast: disabled states are exempt, and a page with its own <style> keeps its tokens apart from the app', () => {
  assert.equal(run('d8.token_pair_contrast', css('.a:disabled { color: #ccc; background: #fff; }')).status, 'not_measured');
  const r = run('d8.token_pair_contrast', {
    ...css(':root { --bg: #fff; --text: #111; }\nbody { color: var(--text); }'),
    ...view('<style>:root { --ink: #eee; }\np { color: var(--ink); }</style><p>x</p>', 'resources/views/welcome.blade.php'),
  });
  assert.equal(r.status, 'measured');
  assert.deepEqual(r.findings, [], 'the page-local --ink is not crossed with the app --bg');
  assert.match(r.evidence[0].detail, /^1 of 1 pair\/theme.*ground 1;/, 'only the app\'s own --text on --bg (light) is evaluated; the page has no ground of its own and its --ink is not crossed with the app\'s grounds');
});

test('contrast: DESIGN.md front matter components are checked (light theme)', () => {
  const md = '---\ncolors:\n  primary: "#1d4f91"\n  on-primary: "#ffffff"\n  accent: "#ffcc00"\ncomponents:\n  button:\n    backgroundColor: "{colors.accent}"\n    textColor: "{colors.on-primary}"\n---\n# Design\n';
  const r = run('d8.token_pair_contrast', { 'DESIGN.md': md, ...view('<p>hi</p>') });
  assert.equal(r.status, 'measured');
  assert.ok(r.findings.some((f) => f.severity === 'blocker' && f.location.file === 'DESIGN.md' && /components\.button/.test(f.message)));
});

// ---- static accessibility ---------------------------------------------------------------------------

test('a11y: alt="" is a decorative image and is allowed; a missing alt is not', () => {
  const r = run('d8.labels_alt_lang', view('<img src="a.png" alt="">\n<img src="b.png">\n<img src="c.png" alt="A chart">\n<img src="d.png" role="presentation">'));
  assert.deepEqual(brief(r), ['img-alt-missing blocker resources/views/page.blade.php:2']);
  assert.equal(r.evidence[0].result, 0.75);
});

test('a11y: dynamic and component content is opaque, never reported', () => {
  const r = run('d8.labels_alt_lang', view('<img src="{{ $u }}" alt="{{ $a }}">\n<img {{ $attributes }}>\n<x-image src="a" />\n<input {{ $attributes }}>\n<x-text-input id="a" />\n<button><x-icon name="x" /></button>\n<a href="/x">{{ $title }}</a>\n<button>@lang(\'Save\')</button>'));
  assert.deepEqual(r.findings, []);
  assert.equal(r.status === 'measured' ? r.evidence[0].result : 1, 1);
});

test('a11y: labels by for/id, wrapping, aria-label, aria-labelledby; a placeholder alone is not a label', () => {
  const r = run('d8.labels_alt_lang', view([
    '<label for="a">A</label><input id="a">',
    '<label>B <input></label>',
    '<input aria-label="C">',
    '<input aria-labelledby="h">',
    '<input type="hidden" name="t">',
    '<input type="submit" value="Go">',
    '<input placeholder="D">',
    '<select id="s"></select>',
  ].join('\n')));
  assert.deepEqual(brief(r), ['control-no-label major resources/views/page.blade.php:7', 'control-no-label major resources/views/page.blade.php:8']);
  assert.match(r.findings[0].message, /placeholder is not a label/);
});

test('a11y: html lang, title and viewport rules', () => {
  const ok = run('d8.labels_alt_lang', view('<!doctype html>\n<html lang="{{ app()->getLocale() }}">\n<head><meta name="viewport" content="width=device-width, initial-scale=1"><title>{{ $t }}</title></head><body></body></html>'));
  assert.deepEqual(ok.findings, []);
  const bad = run('d8.labels_alt_lang', view('<html lang="">\n<head><title></title><meta name="viewport" content="width=device-width, user-scalable=no"></head></html>'));
  assert.deepEqual(brief(bad), [
    'html-lang-missing blocker resources/views/page.blade.php:1',
    'title-empty blocker resources/views/page.blade.php:2',
    'viewport-zoom-disabled blocker resources/views/page.blade.php:2',
  ]);
  const scale = run('d8.labels_alt_lang', view('<html lang="en"><head><title>t</title><meta name="viewport" content="width=device-width, maximum-scale=1.0"></head></html>'));
  assert.deepEqual(brief(scale), ['viewport-zoom-disabled blocker resources/views/page.blade.php:1']);
  const fine = run('d8.labels_alt_lang', view('<html lang="en"><head><title>t</title><meta name="viewport" content="width=device-width, maximum-scale=5"></head></html>'));
  assert.deepEqual(fine.findings, []);
});

test('a11y: a page whose head is managed elsewhere is not accused of a missing title', () => {
  const r = run('d8.labels_alt_lang', view('<!doctype html><html lang="en"><head>@inertiaHead</head><body>@inertia</body></html>'));
  assert.deepEqual(r.findings, []);
});

test('a11y: ARIA and keyboard misuse that is visible in markup', () => {
  const r = run('d8.labels_alt_lang', view([
    '<div role="button">x</div>',
    '<div role="button" tabindex="0">ok</div>',
    '<a href="#" aria-hidden="true">hidden link</a>',
    '<div @click="go">click me</div>',
    '<div @click="close"></div>',
    '<button aria-label="Close"><svg></svg></button>',
    '<span role="banana">x</span>',
    '<iframe src="/x"></iframe>',
    '<svg role="img"></svg>',
  ].join('\n')));
  assert.deepEqual(brief(r).filter((x) => !x.startsWith('not-measured')).map((x) => x.replace('resources/views/page.blade.php:', 'L')), [
    'aria-role-not-focusable major L1',
    'aria-hidden-focusable major L3',
    'click-not-keyboard major L4',
    'aria-invalid-role minor L7',
    'iframe-title major L8',
    'svg-img-no-name major L9',
  ]);
});

test('a11y: reusable component files are fragments: their consumer supplies the label', () => {
  const r = run('d8.labels_alt_lang', { 'resources/js/Components/TextInput.vue': '<template><input v-model="m" class="x"></template>', ...view('<img alt="a" src="x">') });
  assert.deepEqual(r.findings, []);
});

test('a11y: focus: positive tabindex, removed outline and its replacements', () => {
  const r = run('d8.focus_visible', {
    ...css('a:focus { outline: none; box-shadow: 0 0 0 2px #000; }\nbutton:focus { outline: 0; }\nbutton:focus-visible { outline: 2px solid #000; }\ninput:focus { outline: none; }\n.mouse:focus:not(:focus-visible) { outline: none; }\nmain:focus { outline: none; }'),
    ...view('<div tabindex="3">x</div>\n<a class="outline-none focus:ring-2">a</a>\n<a class="outline-none">b</a>\n<a class="focus:outline-none focus-visible:ring-2">c</a>'),
  });
  assert.deepEqual(brief(r), [
    'focus-outline-removed major resources/css/app.css:4',
    'tabindex-positive major resources/views/page.blade.php:1',
    'focus-outline-removed major resources/views/page.blade.php:3',
  ]);
  // safe: a, button, the :not(:focus-visible) pattern, main (programmatic focus) and two replaced utilities
  assert.match(r.evidence[0].detail, /^4 of 7/);
});

test('a11y: reduced motion: global override, per-selector override, and what stays uncovered', () => {
  const none = run('d4.reduced_motion', css('.a { transition: color 0.2s; }'));
  assert.equal(none.evidence[0].result, 0);
  const global = run('d4.reduced_motion', css('.a { transition: color 0.2s; }\n.b { animation: x 1s infinite; }\n@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }'));
  assert.equal(global.evidence[0].result, 1);
  const own = run('d4.reduced_motion', css('.a { transition: color 0.2s; }\n.b { animation: x 1s infinite; }\n@media (prefers-reduced-motion: reduce) { .a { transition: none; } }'));
  assert.equal(own.evidence[0].result, 0.5);
  assert.deepEqual(brief(own), ['motion-no-reduced-variant major resources/css/app.css:2']);
  const noPref = run('d4.reduced_motion', css('@media (prefers-reduced-motion: no-preference) { .a { transition: color 0.2s; } }'));
  assert.equal(noPref.evidence[0].result, 1);
  // nothing declared is an empty set: not a pass at 1.00
  const none2 = run('d4.reduced_motion', css('.a { color: red; }'));
  assert.equal(none2.status, 'not_measured');
  assert.deepEqual(none2.evidence, []);
  assert.match(reasonOf(none2), /nothing to cover/);
  const tw = run('d4.reduced_motion', view('<div class="animate-spin"></div>\n<div class="animate-spin motion-reduce:animate-none"></div>\n<div class="transition-none"></div>'));
  assert.equal(tw.evidence[0].result, 0.5);
});

// ---- structure --------------------------------------------------------------------------------------

test('headings: order, skips, one h1; layouts and pages that extend them are not failed for what they cannot see', () => {
  const ok = run('d3.heading_structure', view('<h1>a</h1><h2>b</h2><h3>c</h3><h2>d</h2>'));
  assert.equal(ok.evidence[0].result, 1);
  const skip = run('d3.heading_structure', view('<h1>a</h1>\n<h3>c</h3>'));
  assert.deepEqual(brief(skip), ['heading-skip minor resources/views/page.blade.php:2']);
  const two = run('d3.heading_structure', view('<h1>a</h1>\n<h1>b</h1>'));
  assert.deepEqual(brief(two), ['h1-multiple minor resources/views/page.blade.php:2']);
  const down = run('d3.heading_structure', view('<h1>a</h1><h4>x</h4><h2>y</h2>'));
  assert.equal(brief(down).length, 1, 'going back up is fine; only the jump down is a skip');
  const extending = run('d3.heading_structure', view("@extends('layouts.app')\n<h2>only a section</h2>"));
  assert.equal(extending.status, 'not_measured');
  const layout = run('d3.heading_structure', { 'resources/views/layouts/app.blade.php': '<html lang="en"><body><h2>x</h2>@yield("content")</body></html>' });
  assert.equal(layout.status, 'not_measured');
});

test('forms: radio groups count once, hidden fields and buttons not at all, the bound is explicit', () => {
  const eight = Array.from({ length: 8 }, (_, i) => `<input name="f${i}">`).join('');
  const r8 = run('d3.field_counts', view(`<form>${eight}<input type="hidden"><button>Go</button></form>`));
  assert.equal(r8.evidence[0].result, 1);
  const r9 = run('d3.field_counts', view(`<form>${eight}<input name="x"></form>`));
  assert.equal(r9.evidence[0].result, 0);
  const radios = run('d3.field_counts', view(`<form>${eight}<input type="radio" name="r"><input type="radio" name="r"><input type="radio" name="r"></form>`));
  assert.equal(radios.evidence[0].result, 0, '8 + one radio group is 9');
  const custom = run('d3.field_counts', view(`<form>${eight}<input name="x"></form>`), PROFILE, { options: { max_fields_per_form: 9 } });
  assert.equal(custom.evidence[0].result, 1);
  assert.match(custom.evidence[0].detail, /bound supplied by the caller/);
  assert.match(r8.evidence[0].detail, /engine default bound/);
  assert.equal(run('d3.field_counts', view('<p>no forms</p>')).status, 'not_measured');
});

test('navigation: depth is nesting inside <nav>, with an explicit bound', () => {
  const nav = '<nav><ul><li><a href="/a">A</a><ul><li><a href="/b">B</a></li></ul></li></ul></nav>';
  assert.equal(run('d3.nav_depth', view(nav)).evidence[0].result, 1);
  const tight = run('d3.nav_depth', view(nav), PROFILE, { options: { nav_depth_bound: 1 } });
  assert.equal(tight.evidence[0].result, 0.5);
  assert.equal(run('d3.nav_depth', view('<p>no nav</p>')).status, 'not_measured');
});

test('dead links: route names, route paths, public files, package routes and variables', () => {
  const routes = "<?php\nRoute::get('/about', fn () => view('about'))->name('about');\nRoute::get('/users/{id}', fn () => 1)->name('users.show');\n";
  const r = run('d5.dead_links', {
    'routes/web.php': routes,
    'public/robots.txt': 'x',
    ...view([
      "<a href=\"{{ route('about') }}\">1</a>",
      "<a href=\"{{ route('missing') }}\">2</a>",
      '<a href="/about">3</a>',
      '<a href="/nowhere">4</a>',
      '<a href="/users/{{ $u->id }}">5</a>',
      '<a href="/robots.txt">6</a>',
      '<a href="{{ $url }}">7</a>',
      '<a href="https://example.com/x">8</a>',
      '<a href="#top">9</a>',
      '<a href="mailto:a@b.c">10</a>',
      "<a href=\"{{ url('/about') }}\">11</a>",
      "<a href=\"{{ url('/gone') }}\">12</a>",
    ].join('\n')),
  });
  assert.deepEqual(brief(r).map((x) => x.replace('resources/views/page.blade.php:', 'L')), ['dead-internal-link major L2', 'dead-internal-link major L4', 'dead-internal-link major L12']);
  assert.equal(r.evidence[0].result, 0.625, 'resolved: 1, 3, 5, 6, 11; dead: 2, 4, 12');
  assert.match(r.evidence[0].detail, /1 link\(s\) could not be judged/);
  // package routes: login is not defined in routes/*.php but the app installs Fortify
  const pkg = run('d5.dead_links', { 'routes/web.php': routes, 'composer.json': '{"require":{"laravel/fortify":"^1"}}', ...view('<a href="{{ route(\'login\') }}">x</a><a href="/about">y</a>') });
  assert.deepEqual(pkg.findings, []);
});

test('dead links: plain static HTML sites resolve against files', () => {
  const r = run('d5.dead_links', { 'index.html': '<a href="about.html">a</a><a href="/missing.html">b</a><a href="docs/">c</a>', 'about.html': '<p>x</p>', 'docs/index.html': '<p>d</p>' });
  assert.deepEqual(brief(r), ['dead-internal-link major index.html:1']);
});

test('dead links with nothing checkable are not a pass', () => {
  assert.equal(run('d5.dead_links', view('<a href="https://example.com">x</a>')).status, 'not_measured');
  assert.equal(run('d5.dead_links', { 'resources/js/Pages/A.vue': '<template><a href="/x">x</a></template>' }).status, 'not_measured');
});

test('stubs: lorem, TODO, placeholders and coming soon; developer comments are info and do not count', () => {
  const r = run('d5.stubs_placeholders', {
    'resources/views/a.blade.php': '<p>Lorem Ipsum dolor</p>\n<p>TODO write this</p>\n<p>Coming soon</p>',
    'resources/views/b.blade.php': '{{-- TODO later --}}\n<p>Real content</p>',
    'resources/views/c.blade.php': '<p>Your text here</p>',
  });
  assert.deepEqual(brief(r), [
    'lorem-ipsum major resources/views/a.blade.php:1',
    'todo-marker major resources/views/a.blade.php:2',
    'coming-soon minor resources/views/a.blade.php:3',
    'todo-comment info resources/views/b.blade.php:1',
    'placeholder-text major resources/views/c.blade.php:1',
  ]);
  assert.equal(r.evidence[0].result, 0.3333);
  assert.equal(run('d5.stubs_placeholders', view('<p>{{ $x }}</p>')).status, 'not_measured');
});

test('route inventory: needs a feature list and something to compare it with', () => {
  assert.equal(run('d5.route_inventory_vs_claims', { 'README.md': '# x\nsome text', ...view('<p>x</p>') }).status, 'not_measured');
  assert.equal(run('d5.route_inventory_vs_claims', { 'README.md': '## Features\n- Invoices\n', 'routes/web.php': '<?php\n' }).status, 'not_measured', 'no routes or pages to compare');
  const r = run('d5.route_inventory_vs_claims', { 'README.md': '## Features\n- **Invoices** - create them\n- Reports\n', 'routes/web.php': "<?php\nRoute::resource('invoices', C::class);\n", ...view('<p>x</p>') });
  assert.equal(r.evidence[0].result, 0.5);
  assert.deepEqual(brief(r), ['claim-without-route minor README.md:3']);
});

test('error pages: framework default layout, no next step, 4xx/5xx fallbacks and an include that holds the link', () => {
  const base = { 'routes/web.php': '<?php\n', 'composer.json': '{}' };
  const r = run('d10.error_pages', {
    ...base,
    'resources/views/errors/4xx.blade.php': '<h1>Oops</h1><a href="/">Home</a>',
    'resources/views/errors/500.blade.php': "@extends('errors::minimal')",
    'resources/views/errors/503.blade.php': "@include('errors._shell')",
    'resources/views/errors/_shell.blade.php': '<h1>Down</h1><a href="/">Try again</a>',
    ...view('<p>x</p>'),
  });
  assert.deepEqual(brief(r), ['error-page-framework-default minor resources/views/errors/500.blade.php:1']);
  assert.equal(r.evidence[0].result, 0.8, '403, 404, 419 via 4xx; 503 via its include');
  const noLink = run('d10.error_pages', { ...base, 'resources/views/errors/404.blade.php': '<h1>Gone</h1>', ...view('<p>x</p>') });
  assert.ok(noLink.findings.some((f) => f.id.includes('error-page-no-next-step')));
});

test('error pages for a static site: only 404 is expected', () => {
  const r = run('d10.error_pages', { 'index.html': '<p>x</p>', '404.html': '<h1>Not found</h1><a href="/">Home</a>' });
  assert.equal(r.evidence[0].result, 1);
  assert.match(r.evidence[0].detail, /only 404/);
});

test('health endpoint: framework route, listener, handler failure paths, and "answers" is never credited', () => {
  const bare = run('d10.health_endpoint', { 'bootstrap/app.php': "<?php\nreturn Application::configure()->withRouting(web: 'x', health: '/up')->create();\n" });
  assert.equal(bare.evidence[0].result, 0.3333);
  assert.deepEqual(brief(bare), ['health-failure-path-not-seen minor bootstrap/app.php:2']);
  const withListener = run('d10.health_endpoint', { 'bootstrap/app.php': "<?php\nreturn Application::configure()->withRouting(health: '/up');\n", 'app/Providers/H.php': '<?php\nEvent::listen(DiagnosingHealth::class, fn () => 1);\n' });
  assert.equal(withListener.evidence[0].result, 0.6667);
  const custom = run('d10.health_endpoint', { 'routes/web.php': "<?php\nRoute::get('/health', [HealthController::class, 'show']);\n", 'app/Http/Controllers/HealthController.php': '<?php\nclass HealthController { function show() { try { DB::connection()->getPdo(); } catch (\\Throwable $e) { return response("down", 503); } return "ok"; } }\n' });
  assert.equal(custom.evidence[0].result, 0.6667);
  assert.deepEqual(custom.findings, []);
  const none = run('d10.health_endpoint', { 'routes/web.php': "<?php\nRoute::get('/', fn () => 1);\n" });
  assert.equal(none.evidence[0].result, 0);
});

test('privacy and terms: present, real, linked; a body rendered from a variable earns no credit and no accusation', () => {
  const words = Array.from({ length: 90 }, (_, i) => `word${i}`).join(' ');
  const r = run('d6.privacy_terms_present', {
    'routes/web.php': "<?php\nRoute::get('/privacy', fn () => view('privacy'));\nRoute::get('/terms', fn () => view('terms'));\n",
    'resources/views/privacy.blade.php': `<h1>Privacy</h1><p>${words}</p>`,
    'resources/views/terms.blade.php': '<h1>Terms</h1>{!! $terms !!}',
    'resources/views/layouts/app.blade.php': '<footer><a href="/privacy">Privacy</a></footer>',
  });
  assert.equal(r.evidence[0].result, 0.6667, 'privacy 3/3, terms present only');
  assert.deepEqual(brief(r), ['terms-not-linked minor resources/views/terms.blade.php:1']);
  assert.match(r.evidence[0].detail, /not judged and earn no credit/);
});

// ---- claims -----------------------------------------------------------------------------------------

test('claims: an evidence marker downgrades a finding to info only when the file exists', () => {
  const files = (marker) => ({
    'docs/audit.md': '# audit',
    ...view(`${marker}\n<p>Trusted by 5,000 businesses.</p>\n<p data-evidence="docs/audit.md">ISO 27001 certified.</p>\n<p data-evidence="docs/missing.md">SOC 2 compliant.</p>`),
  });
  const r = run('d6.claim_lint', files('{{-- evidence: docs/audit.md --}}'));
  assert.deepEqual(brief(r).map((x) => x.replace('resources/views/page.blade.php:', 'L')), ['invented-count info L2', 'compliance-claim info L3', 'compliance-claim blocker L4']);
  assert.match(r.findings[0].message, /Evidence marker docs\/audit\.md found/);
  assert.match(r.findings[2].message, /names a file that is not in the checkout/);
  const none = run('d6.claim_lint', files(''));
  assert.equal(none.findings[0].severity, 'blocker');
  // an evidence marker cannot point outside the checkout
  const esc = run('d6.claim_lint', view('<p data-evidence="../../etc/passwd">Trusted by 5,000 businesses.</p>'));
  assert.equal(esc.findings[0].severity, 'blocker');
  const url = run('d6.claim_lint', view('<p data-evidence="https://example.com/proof">Trusted by 5,000 businesses.</p>'));
  assert.equal(url.findings[0].severity, 'blocker', 'a URL cannot be verified offline');
});

test('claims: each family of claim is found, and ordinary wording is left alone', () => {
  const hit = (text) => substantive(run('d6.claim_lint', view(`<p>${text}</p>`))).map((f) => f.id.split('.')[2]);
  const cases = [
    ['Trusted by 12,000 teams', ['invented-count']],
    ['Join 500+ businesses today', ['invented-count']],
    ['Save up to 40% faster reporting', ['invented-percent']],
    ['Rated 4.8/5 by users', ['invented-rating']],
    ['Enterprise-ready and bank-grade', ['compliance-claim']],
    ['GDPR compliant, ISO 27001', ['compliance-claim']],
    ['We are ISO 9001 certified', ['compliance-claim']],
    ['SOC 2 Type II audited', ['compliance-claim']],
    ['We offer a money-back guarantee', ['guarantee']],
    ['We are fully licensed and regulated by the FSCA', ['authorisation-claim']],
    ['FSP 12345', ['authorisation-claim']],
    ['Earn passive income with monthly returns of 5%', ['returns-claim']],
    ['The best platform. #1 choice', ['superlative']],
    ['Ranked #1 in the market', ['superlative']],
    ['Our win rate is 80%', ['performance-term']],
    ['Offer ends today. Only 3 left', ['fake-urgency']],
  ];
  for (const [text, want] of cases) assert.deepEqual([...new Set(hit(text))], want, text);
  for (const fine of [
    'Up to 5 users per plan', 'Add 3 team members', 'No guarantee of availability', 'We cannot guarantee results', 'Licensed under the MIT licence',
    'You are authorised to view this page', 'Returns policy', 'Profit and loss statement', 'Step 2 of 3', 'Copyright 2026',
    'Best practices for passwords', 'A regulated industry', 'Monthly Income', 'Built against the ISO 15143-3 telematics API', 'Download links expire after a limited time',
    'Volvo Excavator #1', 'Order #1042 confirmed', 'High priority',
  ]) assert.deepEqual(hit(fine), [], fine);
});

test('claims: evidence markers work in PHP language files too', () => {
  const r = run('d6.claim_lint', {
    'docs/audit.md': '# audit',
    ...view('<p>ok</p>'),
    'lang/en/home.php': "<?php\nreturn [\n  // evidence: docs/audit.md\n  'proof' => 'Trusted by 5,000 businesses',\n  'bad' => 'Trusted by 9,000 teams', // evidence: docs/none.md\n];\n",
  });
  assert.deepEqual(brief(r), ['invented-count info lang/en/home.php:4', 'invented-count blocker lang/en/home.php:5']);
});

test('claims: testimonials need a source and countdown timers are urgency', () => {
  const r = run('d6.claim_lint', view('<blockquote>Great!</blockquote>\n<figure><blockquote>Fine</blockquote><figcaption>Ann, Acme</figcaption></figure>\n<div class="countdown"></div>\n<blockquote cite="https://x.test">Ok</blockquote>'));
  assert.deepEqual(brief(r).map((x) => x.replace('resources/views/page.blade.php:', 'L')), ['testimonial-no-source major L1', 'countdown-timer major L3']);
});

test('claims: dynamic figures are not invented figures', () => {
  const r = run('d6.claim_lint', view('<p>Trusted by {{ $count }} businesses</p><p>Only {{ $stock }} left</p>'));
  assert.deepEqual(substantive(r), []);
  assert.equal(r.status, 'not_measured', 'nothing claim-bearing is left, so there is no share to measure');
});

test('copy lint: banned phrases match inflections, hyphens and line breaks, not substrings', () => {
  const r = run('d1.copy_profile_language_lint', view('<p>A seamlessly smooth app</p>\n<p>A game\nchanging idea</p>\n<p>It is game-changing.</p>\n<p>Seamstress</p>'), PROFILE);
  // the phrase may be broken across a line (line 2) and uses a hyphen or a space; "Seamstress" is not "seamless"
  assert.deepEqual(brief(r).map((x) => x.replace('resources/views/page.blade.php:', 'L')), ['banned-phrase major L1', 'banned-phrase major L2', 'banned-phrase major L4']);
});

test('copy lint reads language files, attributes and meta descriptions, and skips <code>', () => {
  const r = run('d1.copy_profile_language_lint', {
    'lang/en/messages.php': "<?php\nreturn [\n  'hero' => 'A seamless start',\n  // evidence: docs/x.md\n  'ok' => 'Fine',\n];\n",
    'resources/lang/en.json': '{\n  "Welcome": "Welcome",\n  "Tag": "Game-changing"\n}',
    ...view('<img alt="seamless demo" src="a.png">\n<meta name="description" content="A game-changing app">\n<code>seamless</code>\n<p>ok</p>'),
  });
  assert.deepEqual(brief(r), [
    'banned-phrase major lang/en/messages.php:3',
    'banned-phrase major resources/lang/en.json:3',
    'banned-phrase major resources/views/page.blade.php:1',
    'banned-phrase major resources/views/page.blade.php:2',
  ]);
});

// ---- tokens -----------------------------------------------------------------------------------------

test('tokens: nothing declared and nothing hard-coded is not a pass', () => {
  assert.equal(run('d9.token_usage_vs_profile', view('<p>x</p>')).status, 'not_measured');
  assert.equal(run('d4.spacing_type_scale_conformance', css('.a { padding: 13px; }')).status, 'not_measured');
  assert.equal(run('d2.font_palette_deny_list', css('.a { color: red; }')).status, 'not_measured');
});

test('tokens: literals in custom property definitions are definitions, not hard-coded uses', () => {
  const r = run('d9.token_usage_vs_profile', css(':root { --ink: #111; }\n.a { color: var(--ink); border: 1px solid var(--ink); }'));
  assert.equal(r.evidence[0].result, 1);
  const lit = run('d9.token_usage_vs_profile', css(':root { --ink: #111; }\n.a { color: var(--ink); background: #fafafa; }'));
  assert.equal(lit.evidence[0].result, 0.5);
});

test('tokens: undefined var(), inline styles, svg attributes and utility classes', () => {
  const r = run('d9.token_usage_vs_profile', {
    ...css(':root { --ink: #111; --color-brand: #123; }'),
    ...view('<p style="color: #ff0000; margin: 13px">a</p>\n<svg><path fill="#00ff00"/></svg>\n<div class="bg-brand text-blue-500 bg-[#abcdef] text-[color:var(--ink)]"></div>\n<p style="color: var(--nope)">z</p>'),
  });
  assert.equal(r.status, 'measured');
  assert.ok(r.findings.some((f) => f.id.includes('undefined-token') && /--nope/.test(f.message)));
  // tokens: bg-brand; non-tokens: #ff0000, 13px, #00ff00, text-blue-500 (framework default), #abcdef
  assert.match(r.evidence[0].detail, /colour 1 token \/ 3 literal \/ 1 framework-default/);
});

test('tokens: a declared scale is conformed to by var() and by a literal equal to a step, not by an odd value', () => {
  const r = run('d4.spacing_type_scale_conformance', css(':root { --space-1: 4px; --space-2: 8px; --text-md: 1rem; }\n.a { padding: 8px 12px; margin: var(--space-1); font-size: 16px; }\n.b { font-size: 17px; gap: 0; }'));
  // spacing: 8px ok, 12px off, var ok; type: 16px = 1rem ok, 17px off -> 3 of 5
  assert.equal(r.evidence[0].result, 0.6);
  assert.equal(r.findings.length, 1);
});

test('fonts: a font that DESIGN.md does not declare is reported without moving the share', () => {
  const md = '---\ntypography:\n  body:\n    fontFamily: "Archivo, sans-serif"\n    fontSize: 16px\n---\n# D\n';
  const r = run('d2.font_palette_deny_list', { 'DESIGN.md': md, ...css('.a { font-family: "Archivo", sans-serif; }\n.b { font-family: "Fraunces", serif; }') });
  assert.equal(r.evidence[0].result, 1);
  assert.deepEqual(brief(r), ['font-not-declared minor resources/css/app.css:2']);
});

test('tokens: with no scale declared the check says so as an info finding and stays not_measured', () => {
  const r = run('d4.spacing_type_scale_conformance', css('.a { padding: 13px; }'));
  assert.equal(r.status, 'not_measured');
  assert.deepEqual(brief(r), ['not-measured info -', 'no-scale-declared info resources/css/app.css:1']);
});

test('fonts: the profile names a font, the built-in list names a default, a chosen font passes', () => {
  const profile = { ...PROFILE, visual_direction: { ...PROFILE.visual_direction, prohibited: [{ text: 'Do not use Papyrus anywhere.' }, { text: 'No flat #ff00ff gradients.' }] } };
  const r = run('d2.font_palette_deny_list', css('.a { font-family: "Papyrus", serif; color: #ff00ff; }\n.b { font-family: Arial, sans-serif; }\n.c { font-family: "Fraunces", Georgia, serif; color: #123456; }'), profile);
  assert.deepEqual(brief(r), [
    'font-on-deny-list major resources/css/app.css:1',
    'palette-on-deny-list major resources/css/app.css:1',
    'font-on-deny-list minor resources/css/app.css:2',
  ]);
  assert.equal(r.evidence[0].result, 0.4);
  const noPalette = run('d2.font_palette_deny_list', css('.c { font-family: "Fraunces", serif; color: #ff00ff; }'));
  assert.match(noPalette.evidence[0].detail, /palette was not evaluated/);
});

// ---- applicability ----------------------------------------------------------------------------------

test('a repository with no user interface: every check is not_applicable, with no evidence and no findings', () => {
  const root = tmpRepo({ 'src/cli.js': 'console.log(1)', 'README.md': '# cli', 'package.json': '{}' });
  for (const [id, { mod }] of checks) {
    assert.equal(mod.appliesTo({ root, profile: null }), false, id);
    const r = mod.run({ root, profile: null });
    assert.equal(r.status, 'not_applicable', id);
    assert.deepEqual(r.evidence, []);
    assert.deepEqual(r.findings, [], 'not_applicable carries no findings: the analyzer rejects them');
    assert.deepEqual(Object.keys(r).sort(), ['evidence', 'findings', 'status']);
  }
});

test('an unreadable root is not_measured, not a crash and not a pass', () => {
  for (const root of ['/definitely/not/here', '', null, undefined, 12]) {
    for (const [id, { mod }] of checks) {
      const r = mod.run({ root, profile: null });
      assert.equal(r.status, 'not_measured', `${id} ${root}`);
      assert.deepEqual(r.evidence, []);
      assert.match(reasonOf(r), /could not be read/);
    }
  }
});
