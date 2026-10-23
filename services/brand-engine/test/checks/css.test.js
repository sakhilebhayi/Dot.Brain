// The CSS reader: nesting, at-rules, theme layering, var() resolution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThemes, classifySelector, colorOf, firstColorExpr, nameOf, parseCss, resolveVars, splitTop, stripComments } from '../../src/analyze/checks/_lib/css.js';
import { toHex } from '../../src/analyze/checks/_lib/color.js';

test('comments are blanked and line numbers survive', () => {
  const { rules } = parseCss('/* a\nb */\n.x {\n  color: red; /* c */\n  background: blue;\n}\n');
  assert.equal(rules[0].line, 3);
  assert.deepEqual(rules[0].decls.map((d) => [d.prop, d.value, d.line]), [['color', 'red', 4], ['background', 'blue', 5]]);
  assert.equal(stripComments('a/*x*/b'), `a${' '.repeat(5)}b`);
});

test('declarations without a final semicolon, url() with semicolons and braces in strings', () => {
  const { rules } = parseCss('.a{background:url("data:image/svg+xml;utf8,<svg>{}</svg>") no-repeat;color:#fff}');
  assert.deepEqual(rules[0].decls.map((d) => d.prop), ['background', 'color']);
});

test('media and layer context is recorded, nesting is resolved, keyframes are not rules of elements', () => {
  const { rules } = parseCss('@layer base { @media (min-width: 1px) { .a { color: red; &:hover { color: blue; } .b & { color: green } } } }\n@keyframes k { from { opacity: 0 } to { opacity: 1 } }');
  const sel = rules.filter((r) => !r.keyframes).map((r) => r.selector);
  assert.deepEqual(sel, ['.a', '.a:hover', '.b .a']);
  assert.deepEqual(rules[0].at, ['@layer base', '@media (min-width: 1px)']);
  assert.equal(rules.filter((r) => r.keyframes).length, 1);
});

test('SCSS variables become tokens', () => {
  const { rules } = parseCss('$ink: #111;\n.a { color: $ink; }', { scss: true });
  assert.ok(rules.some((r) => r.decls.some((d) => d.prop === '$ink' && d.value === '#111')));
});

test('selector classification: base, dark, light, scoped, and :not() is ignored', () => {
  assert.equal(classifySelector(':root', []), 'base');
  assert.equal(classifySelector('html', []), 'base');
  assert.equal(classifySelector(':root', ['@media (prefers-color-scheme: dark)']), 'dark');
  assert.equal(classifySelector(':root:not([data-theme="light"])', ['@media (prefers-color-scheme: dark)']), 'dark');
  assert.equal(classifySelector(':root:not([data-theme="light"])', []), 'base', 'the :not() marker does not make it a light theme');
  assert.equal(classifySelector('[data-theme="dark"]', []), 'dark');
  assert.equal(classifySelector(':root[data-theme=dark]', []), 'dark');
  assert.equal(classifySelector('.dark body', []), 'dark');
  assert.equal(classifySelector('[data-bs-theme=light]', []), 'light');
  assert.equal(classifySelector('.card', []), 'scoped');
  assert.equal(classifySelector('body[data-area="x"]', []), 'scoped');
  assert.equal(classifySelector(':root', ['@media (prefers-contrast: more)']), 'skip');
});

test('themes: dark overlays base; light is base; origins point at the declaration', () => {
  const sheet = { file: 't.css', ...parseCss(':root { --a: #fff; --b: var(--a); }\n@media (prefers-color-scheme: dark) { :root { --a: #000; } }') };
  const t = buildThemes([sheet]);
  assert.equal(t.hasDark, true);
  assert.equal(toHex(colorOf('var(--b)', t.light)), '#ffffff');
  assert.equal(toHex(colorOf('var(--b)', t.dark)), '#000000', 'a chain follows the theme');
  assert.deepEqual(t.origins.get('--a'), { file: 't.css', line: 1 });
});

test('var() chains: fallback, cycles, depth and undefined tokens', () => {
  const tokens = new Map([['--a', 'var(--b)'], ['--b', 'var(--a)'], ['--c', '#123456'], ['--d', 'var(--c)']]);
  assert.equal(resolveVars('var(--d)', tokens), '#123456');
  assert.equal(resolveVars('var(--missing, #abc)', tokens), '#abc');
  assert.equal(resolveVars('var(--missing)', tokens), null);
  assert.equal(resolveVars('var(--a)', tokens), null, 'a cycle is unresolved, not an infinite loop');
  assert.equal(resolveVars('rgb(var(--r) 0 0)', new Map([['--r', '255']])), 'rgb(255 0 0)');
  assert.equal(toHex(colorOf('rgb(var(--r) 0 0)', new Map([['--r', '255']]))), '#ff0000');
});

test('helpers: nameOf, firstColorExpr, splitTop', () => {
  assert.equal(nameOf('var(--ink, #000)'), '--ink');
  assert.equal(nameOf(' #fff '), '#fff');
  assert.equal(firstColorExpr('var(--x) url(a.png)'), null, 'url means a layered background: not read');
  assert.equal(firstColorExpr('linear-gradient(red, blue)'), null);
  assert.equal(firstColorExpr('#fff'), '#fff');
  assert.equal(firstColorExpr('rgb(0 0 0 / 50%) no-repeat'), 'rgb(0 0 0 / 50%)');
  assert.equal(firstColorExpr('none'), null);
  assert.deepEqual(splitTop('a, b(c, d), e', ','), ['a', ' b(c, d)', ' e']);
});

test('a hostile stylesheet does not throw or hang', () => {
  const nasty = '{'.repeat(5000) + '}'.repeat(10) + '@media'.repeat(2000) + '"'.repeat(999) + '('.repeat(3000);
  assert.doesNotThrow(() => parseCss(nasty));
});
