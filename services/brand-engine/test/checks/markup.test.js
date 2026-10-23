// The template reader: dynamic fragments are opaque, lines survive, components are opaque.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CTL, DYN, decodeEntities, parseTemplate, scanBalanced, textOf } from '../../src/analyze/checks/_lib/markup.js';

const els = (t, tag) => t.elements.filter((e) => e.tag === tag);

test('Blade echoes become one opaque value marker and the expression is kept in order', () => {
  const t = parseTemplate('<a href="{{ route(\'home\') }}">{{ $label }}</a>\n<img src="{!! $src !!}" alt="{{ $alt }}">', 'blade');
  const [a] = els(t, 'a');
  assert.equal(a.attrs.get('href').value, DYN);
  assert.deepEqual(a.attrs.get('href').exprs, ["{{ route('home') }}"]);
  assert.equal(t.texts[0].text, DYN);
  const [img] = els(t, 'img');
  assert.equal(img.attrs.get('alt').dynamic, true);
  assert.equal(img.line, 2);
});

test('Blade directives with arguments are removed, control flow leaves no text', () => {
  const t = parseTemplate("@extends('layouts.app')\n@section('content')\n@if ($a > 1 && foo(')'))\n<p>Hi</p>\n@else\n<p>Bye</p>\n@endif\n@endsection", 'blade');
  assert.deepEqual(t.texts.map((x) => x.text.replaceAll(CTL, '').trim()), ['Hi', 'Bye']);
  assert.deepEqual(els(t, 'p').map((p) => p.line), [4, 6]);
});

test('an e-mail address and a Vue @click are not Blade directives', () => {
  const t = parseTemplate('<p>write to me@example.com</p><button @click="open = true">Go</button>', 'blade');
  assert.match(t.texts[0].text, /me@example\.com/);
  assert.ok(els(t, 'button')[0].attrs.has('@click'));
});

test('{{-- --}} and <!-- --> comments are removed from text but kept as notes, with evidence markers', () => {
  const t = parseTemplate('<p>a</p>\n{{-- evidence: docs/audit.md --}}\n<!-- TODO fix me -->\n<p>b</p>', 'blade');
  assert.deepEqual(t.texts.map((x) => x.text.trim()), ['a', 'b']);
  assert.deepEqual(t.evidenceMarkers, [{ ref: 'docs/audit.md', line: 2 }]);
  assert.equal(t.comments.find((c) => /TODO/.test(c.text)).line, 3);
});

test('attribute names: bound, aliased and spread forms', () => {
  const t = parseTemplate('<template><img :alt="label" v-bind="$attrs"><input v-model="x" :aria-label="l"><label htmlFor="a" className="b">x</label></template>', 'vue');
  const [img] = els(t, 'img');
  assert.equal(img.attrs.get('alt').dynamic, true);
  assert.equal(img.dynamicAttrs, true, 'v-bind="obj" may supply any attribute');
  assert.equal(els(t, 'input')[0].attrs.get('aria-label').dynamic, true);
  const [label] = els(t, 'label');
  assert.equal(label.attrs.get('for').value, 'a');
  assert.equal(label.attrs.get('class').value, 'b');
});

test('an opaque fragment inside a tag marks the element dynamic', () => {
  const t = parseTemplate('<img {{ $attributes }} src="x"><input @disabled($x) name="n">', 'blade');
  assert.equal(els(t, 'img')[0].dynamicAttrs, true);
  assert.equal(els(t, 'input')[0].dynamicAttrs, false, 'a directive that only toggles an attribute does not');
});

test('components are flagged opaque; plain HTML is not', () => {
  const t = parseTemplate('<x-button>Go</x-button><livewire:cart /><div></div><my-element></my-element><IMG SRC="a">', 'blade');
  assert.deepEqual(t.elements.map((e) => [e.tag, e.component]), [['x-button', true], ['livewire:cart', true], ['div', false], ['my-element', true], ['img', false]]);
  const v = parseTemplate('<template><MyThing/><div></div></template>', 'vue');
  assert.deepEqual(v.elements.map((e) => [e.tag, e.component]), [['mything', true], ['div', false]]);
});

test('script and style bodies are not markup; style blocks are collected with their line', () => {
  const t = parseTemplate('<div>a</div>\n<style>\n.x { color: red; }\n</style>\n<script>if (a < b) { document.write("<p>no</p>"); }</script>\n<p>z</p>', 'html');
  assert.deepEqual(t.texts.map((x) => x.text.trim()), ['a', 'z']);
  assert.equal(t.styleBlocks.length, 1);
  assert.equal(t.styleBlocks[0].line, 2);
  assert.match(t.styleBlocks[0].css, /color: red/);
});

test('Vue: only <template> is markup', () => {
  const src = '<script setup>\nconst a = 1 < 2;\n</script>\n<template>\n  <h1>Title</h1>\n</template>\n<style>.a{color:red}</style>';
  const t = parseTemplate(src, 'vue');
  assert.deepEqual(t.elements.map((e) => e.tag), ['h1']);
  assert.equal(els(t, 'h1')[0].line, 5);
});

test('JSX: braces are opaque, code outside elements is not copy', () => {
  const src = 'const n = 3;\nexport default function A() {\n  return (\n    <main>\n      <h1>Hello {name}</h1>\n      <img src={src} />\n    </main>\n  );\n}';
  const t = parseTemplate(src, 'jsx');
  assert.deepEqual(t.texts.map((x) => x.text.replaceAll(DYN, '#').trim()), ['Hello #']);
  assert.equal(els(t, 'img')[0].attrs.get('src').dynamic, true);
});

test('implied end tags: <li> and <p> do not nest', () => {
  const t = parseTemplate('<ul><li>a<li>b</ul><p>x<p>y', 'html');
  const lis = els(t, 'li');
  assert.equal(lis.length, 2);
  assert.equal(lis[1].parent.tag, 'ul');
});

test('textOf concatenates descendants; entities decode', () => {
  const t = parseTemplate('<button>Save <b>now</b>&nbsp;&amp; go</button>', 'html');
  assert.equal(decodeEntities(textOf(els(t, 'button')[0])), 'Save now & go');
  assert.equal(decodeEntities('won&rsquo;t &#65;&#x42;'), 'won’t AB');
});

test('scanBalanced respects strings and refuses an unbalanced group', () => {
  assert.equal(scanBalanced("(a, ')', (b))", 0), 13);
  assert.equal(scanBalanced('(a, (b)', 0), -1);
});

test('a malformed file does not throw', () => {
  for (const src of ['<div', '<a href="x', '<p>{{ unclosed', '@if(', '<<<>>>', '<img alt=', '']) {
    assert.doesNotThrow(() => parseTemplate(src, 'blade'), src);
  }
});
