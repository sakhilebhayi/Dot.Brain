// The checks only read inside the checkout, never write, never leave it, and do not echo a file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHECKS_DIR, FIXTURES, PROFILE, loadChecks, runOn, tmpRepo } from './_helpers.js';
import { MAX_BYTES, openRepo, safeRel } from '../../src/analyze/checks/_lib/repo.js';

const checks = await loadChecks();
const BANNED = '<p>A seamless experience</p>';

function lintFindings(root) {
  return runOn(checks, 'd1.copy_profile_language_lint', root, PROFILE).findings;
}

test('safeRel refuses anything that could leave the root', () => {
  for (const bad of ['../x', 'a/../../x', '/etc/passwd', '\\windows\\x', 'C:\\x', '..', '.', '', 'a\0b', '..\\x', null, undefined, 5]) assert.equal(safeRel(bad), null, String(bad));
  assert.equal(safeRel('a/b.txt'), 'a/b.txt');
  assert.equal(safeRel('a/./b.txt'), 'a/b.txt');
  assert.equal(safeRel('a//b.txt'), 'a/b.txt');
});

test('read/exists refuse paths outside the root and files that are not in the scan', () => {
  const outer = mkdtempSync(join(tmpdir(), 'outer-'));
  writeFileSync(join(outer, 'secret.txt'), 'top secret');
  const root = join(outer, 'repo');
  mkdirSync(root);
  writeFileSync(join(root, 'ok.html'), '<p>x</p>');
  const repo = openRepo({ root });
  assert.equal(repo.read('ok.html'), '<p>x</p>');
  for (const p of ['../secret.txt', '/etc/passwd', join(outer, 'secret.txt'), 'ok.html/../../secret.txt']) {
    assert.equal(repo.read(p), null, p);
    assert.equal(repo.exists(p), false, p);
  }
});

test('a symlinked file that points outside the checkout is not read, a symlinked directory is not entered', () => {
  const outer = mkdtempSync(join(tmpdir(), 'outer-'));
  writeFileSync(join(outer, 'leak.blade.php'), BANNED);
  mkdirSync(join(outer, 'dir'));
  writeFileSync(join(outer, 'dir', 'inner.blade.php'), BANNED);
  const root = join(outer, 'repo');
  mkdirSync(join(root, 'resources/views'), { recursive: true });
  writeFileSync(join(root, 'resources/views/real.blade.php'), '<p>fine</p>');
  symlinkSync(join(outer, 'leak.blade.php'), join(root, 'resources/views/leak.blade.php'));
  symlinkSync(join(outer, 'dir'), join(root, 'resources/views/linked'));
  const repo = openRepo({ root });
  assert.deepEqual(repo.list((rel) => rel.startsWith('resources/views/')), ['resources/views/real.blade.php']);
  assert.equal(repo.read('resources/views/leak.blade.php'), null);
  assert.equal(repo.skipped.symlink >= 1, true);
  assert.deepEqual(lintFindings(root), []);
  for (const [id] of checks) assert.doesNotThrow(() => runOn(checks, id, root, PROFILE), id);
});

test('a symlink that stays inside the checkout is followed once, as a file', () => {
  const root = tmpRepo({ 'resources/views/a.blade.php': BANNED });
  symlinkSync(join(root, 'resources/views/a.blade.php'), join(root, 'resources/views/b.blade.php'));
  assert.deepEqual(lintFindings(root).map((f) => f.location.file), ['resources/views/a.blade.php', 'resources/views/b.blade.php']);
});

test('the checkout root may itself be a symlink', () => {
  const root = tmpRepo({ 'resources/views/a.blade.php': BANNED });
  const link = join(mkdtempSync(join(tmpdir(), 'link-')), 'checkout');
  symlinkSync(root, link);
  assert.equal(lintFindings(link).length, 1);
});

test('vendor, node_modules, build output, .git and minified files are skipped; so is a file over the size limit', () => {
  const big = `<p>seamless</p>${' '.repeat(MAX_BYTES + 10)}`;
  const files = {
    'vendor/x/views/a.blade.php': BANNED,
    'node_modules/y/index.html': BANNED,
    'public/build/index.html': BANNED,
    'storage/framework/views/a.blade.php': BANNED,
    'dist/index.html': BANNED,
    '.git/hooks/pre.html': BANNED,
    'tests/views/t.blade.php': BANNED,
    'docs/guide.html': BANNED,
    'resources/views/page.min.html': BANNED,
    'resources/views/huge.blade.php': big,
    'resources/views/ok.blade.php': '<p>fine</p>',
  };
  const root = tmpRepo(files);
  assert.deepEqual(lintFindings(root), []);
  const repo = openRepo({ root });
  assert.equal(repo.read('resources/views/huge.blade.php'), null);
  assert.equal(repo.skipped.large >= 1 || repo.skipped.minified >= 1, true);
  // a stylesheet in a skipped folder or minified is not read for tokens either
  const css = tmpRepo({ 'node_modules/z/a.css': '.a{color:#fff;background:#fff}', 'resources/css/app.min.css': '.a{color:#fff;background:#fff}', 'resources/views/a.blade.php': '<p>x</p>' });
  assert.equal(runOn(checks, 'd8.token_pair_contrast', css, PROFILE).status, 'not_measured');
});

test('a binary file with a template extension is not parsed', () => {
  const root = tmpRepo({});
  writeFileSync(join(root, 'img.html'), Buffer.from([0x3c, 0x70, 0x3e, 0x00, 0xff, 0xfe, 0x73, 0x65, 0x61, 0x6d, 0x6c, 0x65, 0x73, 0x73]));
  assert.deepEqual(lintFindings(root), []);
});

const digest = (root) => {
  const h = createHash('sha256');
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const st = lstatSync(abs);
      const r = rel ? `${rel}/${name}` : name;
      if (st.isDirectory()) { h.update(`d ${r}\n`); walk(abs, r); } else { h.update(`f ${r} ${st.size} ${st.mtimeMs}\n`); h.update(readFileSync(abs)); }
    }
  };
  walk(root, '');
  return h.digest('hex');
};

test('running every check changes nothing in the checkout', () => {
  for (const name of ['good', 'bad']) {
    const root = `${FIXTURES}${name}`;
    const before = digest(root);
    for (const [id] of checks) runOn(checks, id, root, PROFILE);
    assert.equal(digest(root), before, `${name} fixture was modified`);
  }
});

test('source hygiene: no network, no processes, no writes, no environment, no clock in the check sources', () => {
  const sources = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name));
      else if (e.name.endsWith('.js')) sources.push([join(dir, e.name), readFileSync(join(dir, e.name), 'utf8')]);
    }
  };
  walk(CHECKS_DIR);
  assert.ok(sources.length > 25);
  const forbidden = [
    /process\.env/, /from 'node:(?:http|https|http2|net|tls|dgram|dns|child_process|worker_threads|cluster|vm)'/, /\bfetch\s*\(/, /XMLHttpRequest/, /require\(/,
    /\b(?:writeFile|appendFile|mkdir|rmSync|rm|unlink|rename|copyFile|createWriteStream|chmod|symlink)(?:Sync)?\s*\(/, /\bDate\.now\s*\(|new Date\s*\(|performance\.now/, /Math\.random/, /\bimport\s*\(/, /\beval\s*\(|new Function/,
  ];
  for (const [file, text] of sources) {
    const code = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const re of forbidden) assert.ok(!re.test(code), `${file.slice(CHECKS_DIR.length)} matches ${re}`);
  }
});

test('a finding quotes the matched phrase and at most 80 characters of context, never the whole line', () => {
  const left = 'x'.repeat(300);
  const right = 'y'.repeat(300);
  const root = tmpRepo({ 'resources/views/a.blade.php': `<p>${left} seamless ${right}</p>` });
  const [f] = lintFindings(root);
  assert.ok(f, 'found');
  assert.match(f.message, /seamless/);
  assert.ok(!f.message.includes('x'.repeat(60)), 'no more than 40 characters of context on the left');
  assert.ok(!f.message.includes('y'.repeat(60)), 'no more than 40 characters of context on the right');
  assert.ok(f.message.length < 250);
  // a claim check quotes the same way
  const c = tmpRepo({ 'resources/views/a.blade.php': `<p>${left} Trusted by 5,000 businesses ${right}</p>` });
  const [cf] = runOn(checks, 'd6.claim_lint', c, PROFILE).findings;
  assert.ok(!cf.message.includes('x'.repeat(60)) && !cf.message.includes('y'.repeat(60)));
});

test('no result mentions the absolute path of the checkout', () => {
  const root = tmpRepo({ 'resources/views/a.blade.php': `${BANNED}<img src="x">`, 'resources/css/app.css': ':root{--text:#999;--bg:#fff}' });
  const all = JSON.stringify([...checks.keys()].map((id) => runOn(checks, id, root, PROFILE)));
  assert.ok(!all.includes(root), 'absolute path leaked into a result');
  assert.ok(!all.includes(tmpdir()));
});

test('a hostile checkout does not crash or hang a check', () => {
  const root = tmpRepo({
    'resources/views/a.blade.php': `${'<div '.repeat(5000)}${'{{ '.repeat(2000)}${'@if('.repeat(2000)}${'<!--'.repeat(1000)}`,
    'resources/views/b.blade.php': `<p>${'a'.repeat(200000)}</p>`,
    'resources/views/c.blade.php': `${'<ul><li>'.repeat(3000)}`,
    'resources/css/app.css': `${'{'.repeat(5000)}${'@media '.repeat(2000)}${':root{--a:var(--a)}'}`,
    'routes/web.php': `<?php ${'Route::group(['.repeat(1000)}`,
  });
  const t0 = process.hrtime.bigint();
  for (const [id] of checks) assert.doesNotThrow(() => runOn(checks, id, root, PROFILE), id);
  assert.ok(Number(process.hrtime.bigint() - t0) / 1e9 < 10, 'finished in a bounded time');
});
