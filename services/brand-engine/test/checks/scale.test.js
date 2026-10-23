// Determinism and performance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { FIXTURES, PROFILE, loadChecks, runOn, tmpRepo } from './_helpers.js';

const checks = await loadChecks();
const all = (root) => [...checks.keys()].map((id) => runOn(checks, id, root, PROFILE));

test('the same checkout gives byte-identical results, and so does a copy of it somewhere else', () => {
  for (const name of ['good', 'bad']) {
    const a = JSON.stringify(all(`${FIXTURES}${name}`));
    const b = JSON.stringify(all(`${FIXTURES}${name}`));
    assert.equal(a, b, 'run twice');
    const copy = mkdtempSync(join(tmpdir(), 'copy-'));
    cpSync(`${FIXTURES}${name}`, copy, { recursive: true });
    assert.equal(JSON.stringify(all(copy)), a, 'copied to another path');
  }
});

test('the order files are created in does not change the result', () => {
  const files = {
    'resources/views/a.blade.php': '<h1>A</h1><img src="1.png">\n<p>seamless</p>',
    'resources/views/b.blade.php': '<h1>B</h1><h3>x</h3><img src="2.png">',
    'resources/views/c.blade.php': '<h2>C</h2><a href="/missing">x</a>',
    'resources/css/app.css': ':root{--text:#999;--bg:#fff}\n.a{transition:color .2s}',
  };
  const forward = tmpRepo(files);
  const backward = tmpRepo(Object.fromEntries(Object.entries(files).reverse()));
  assert.equal(JSON.stringify(all(forward)), JSON.stringify(all(backward)));
});

test('the same ctx can be run repeatedly, and a fresh ctx for the same root gives the same answer', () => {
  const root = `${FIXTURES}bad`;
  const ctx = { root, profile: PROFILE };
  const first = [...checks.values()].map(({ mod }) => JSON.stringify(mod.run(ctx)));
  const second = [...checks.values()].map(({ mod }) => JSON.stringify(mod.run(ctx)));
  const fresh = [...checks.values()].map(({ mod }) => JSON.stringify(mod.run({ root, profile: PROFILE })));
  assert.deepEqual(first, second);
  assert.deepEqual(first, fresh);
});

test('performance: a 2,000-file checkout is analysed by all checks in a few seconds', () => {
  const root = mkdtempSync(join(tmpdir(), 'big-'));
  const put = (rel, text) => { const abs = join(root, rel); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, text); };
  put('resources/css/app.css', ':root { --bg: #fff; --text: #111; --brand: #145; --space-2: 8px; --text-md: 16px; }\n@media (prefers-color-scheme: dark) { :root { --bg: #000; --text: #eee; } }\nbody { background: var(--bg); color: var(--text); }\n');
  put('routes/web.php', `<?php\n${Array.from({ length: 200 }, (_, i) => `Route::get('/p${i}', fn () => view('pages.p${i}'))->name('p${i}');`).join('\n')}\n`);
  for (let i = 0; i < 1500; i += 1) {
    put(`resources/views/pages/p${i}.blade.php`, `@extends('layouts.app')\n@section('content')\n<h1>Page ${i}</h1>\n<p>Some plain text for page ${i} that says what it does.</p>\n<img src="/i/${i}.png" alt="Picture ${i}">\n<form action="/p${i % 200}" method="post">\n  @csrf\n  <label for="n${i}">Name</label><input id="n${i}" name="n">\n  <button type="submit">Save</button>\n</form>\n<a href="{{ route('p${(i + 1) % 200}') }}">Next</a>\n@endsection\n`);
  }
  for (let i = 0; i < 300; i += 1) put(`resources/css/part${i}.css`, `.c${i} { color: var(--text); background: var(--bg); padding: var(--space-2); transition: color .2s; }\n`);
  for (let i = 0; i < 250; i += 1) put(`app/Models/M${i}.php`, `<?php\nclass M${i} {}\n`);
  put('resources/views/layouts/app.blade.php', '<!doctype html><html lang="en"><head><title>x</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><nav><a href="/">Home</a></nav>@yield("content")</body></html>');

  const t0 = process.hrtime.bigint();
  const results = all(root);
  const seconds = Number(process.hrtime.bigint() - t0) / 1e9;
  assert.ok(results.filter((r) => r.status === 'measured').length >= 15, 'the checks actually measured');
  assert.ok(seconds < 10, `took ${seconds.toFixed(1)}s`);
});
