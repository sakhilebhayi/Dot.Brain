// The file API a check receives: confined to the checkout, bounded, read-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFiles, FileAccessError, globToRegExp, normaliseRel } from '../src/analyze/files.js';
import { FILE_LIMITS } from '../src/analyze/limits.js';
import { tmp, writeText } from './_flow_helpers.js';

function checkout() {
  const root = tmp('files-root-');
  const outside = tmp('files-outside-');
  writeText(join(outside, 'secret.txt'), 'outside the checkout\n');
  writeText(join(root, 'public', 'index.html'), '<html lang="en"></html>\n');
  writeText(join(root, 'src', 'a.css'), 'a{}\n');
  writeText(join(root, 'src', 'deep', 'b.css'), 'b{}\n');
  writeText(join(root, 'README.md'), '# hi\n');
  return { root, outside };
}
const code = (fn) => { try { fn(); } catch (e) { return e instanceof FileAccessError ? e.code : `other:${e.message}`; } return 'no error'; };

test('paths must be relative, plain and free of ".." : anything else throws INVALID_PATH on read and is false on exists', () => {
  const { root } = checkout();
  const { api } = createFiles(root);
  for (const bad of ['', '/etc/passwd', '../x', 'a/../../x', 'a/..', 'a\\b', 'x\0y', 'C:/windows', 'a'.repeat(FILE_LIMITS.maxPathLength + 1), 42, null, undefined, {}]) {
    assert.equal(code(() => api.read(bad)), 'INVALID_PATH', JSON.stringify(bad)?.slice(0, 40));
    assert.equal(api.exists(bad), false);
  }
  assert.equal(normaliseRel('./src//a.css'), 'src/a.css');
});

test('read returns text, null for a missing file, and exists is a plain boolean', () => {
  const { root } = checkout();
  const { api } = createFiles(root);
  assert.equal(api.read('src/a.css'), 'a{}\n');
  assert.equal(api.read('nope.txt'), null);
  assert.equal(api.read('nodir/nope.txt'), null);
  assert.equal(api.exists('src/a.css'), true);
  assert.equal(api.exists('src'), true);
  assert.equal(api.exists('nope'), false);
  assert.equal(code(() => api.read('src')), 'NOT_A_FILE');
});

test('a symlink that leaves the checkout is neither read, listed nor reported as existing; one that stays inside is fine', () => {
  const { root, outside } = checkout();
  symlinkSync(join(outside, 'secret.txt'), join(root, 'link-out.txt'));
  symlinkSync(outside, join(root, 'dir-out'));
  symlinkSync(join(root, 'src', 'a.css'), join(root, 'link-in.css'));
  symlinkSync(root, join(root, 'loop'));
  const files = createFiles(root);
  assert.equal(code(() => files.api.read('link-out.txt')), 'ESCAPE');
  assert.equal(code(() => files.api.read('dir-out/secret.txt')), 'ESCAPE');
  assert.equal(files.api.exists('link-out.txt'), false);
  assert.equal(files.api.exists('dir-out/secret.txt'), false);
  assert.equal(files.api.read('link-in.css'), 'a{}\n');
  const listed = files.api.list('**/*');
  assert.ok(!listed.includes('link-out.txt'));
  assert.ok(!listed.some((p) => p.startsWith('dir-out') || p.startsWith('loop')), 'directory links are never walked');
  assert.ok(listed.includes('link-in.css'));
  const reasons = Object.fromEntries(files.skipped().map((s) => [s.path, s.reason]));
  assert.equal(reasons['link-out.txt'], 'symlink_escapes_root');
});

test('vendored, generated and VCS directories, and credential-shaped names, are not listed or readable', () => {
  const { root } = checkout();
  for (const p of ['node_modules/x/index.js', 'vendor/lib.php', 'build/out.js', 'dist/a.js', '.git/config', 'storage/framework/views/a.php', '.env', '.env.production', 'deploy/id_rsa', 'certs/site.pem', '.npmrc']) writeText(join(root, p), 'x\n');
  writeText(join(root, '.env.example'), 'KEY=\n');
  const files = createFiles(root);
  const listed = files.api.list('**/*');
  assert.deepEqual(listed.filter((p) => /node_modules|vendor|build|dist|\.git|storage|\.env$|\.env\.production|id_rsa|\.pem|\.npmrc/.test(p)), []);
  assert.ok(listed.includes('.env.example'), 'an example file is not a secret');
  for (const p of ['node_modules/x/index.js', 'vendor/lib.php', '.git/config', '.env', 'deploy/id_rsa', 'storage/framework/views/a.php']) {
    assert.equal(code(() => files.api.read(p)), 'DENIED', p);
    assert.equal(files.api.exists(p), false, p);
  }
});

test('minified, binary and oversized files are refused with a reason and recorded as skipped', () => {
  const { root } = checkout();
  writeText(join(root, 'public', 'app.min.js'), 'x');
  writeText(join(root, 'public', 'bundle.js'), `${'a'.repeat(FILE_LIMITS.maxLineChars + 1)}\n`);
  writeFileSync(join(root, 'public', 'logo.bin'), Buffer.from([1, 2, 0, 3]));
  writeText(join(root, 'public', 'big.txt'), 'line\n'.repeat(300000));
  const files = createFiles(root);
  assert.ok(!files.api.list('public/*').includes('public/app.min.js'));
  assert.equal(code(() => files.api.read('public/bundle.js')), 'MINIFIED');
  assert.equal(code(() => files.api.read('public/logo.bin')), 'BINARY');
  assert.equal(code(() => files.api.read('public/big.txt')), 'TOO_LARGE');
  const reasons = new Map(files.skipped().map((s) => [s.path, s.reason]));
  assert.equal(reasons.get('public/bundle.js'), 'minified_or_generated');
  assert.equal(reasons.get('public/logo.bin'), 'binary');
  assert.equal(reasons.get('public/big.txt'), 'over_size_cap');
});

test('a check has a total read budget and a listing limit', () => {
  const { root } = checkout();
  const tight = createFiles(root, { ...FILE_LIMITS, maxTotalReadBytes: 6 });
  assert.equal(tight.api.read('src/a.css'), 'a{}\n');
  assert.equal(code(() => tight.api.read('src/deep/b.css')), 'BUDGET');
  const few = createFiles(root, { ...FILE_LIMITS, maxListedFiles: 2 });
  assert.equal(few.api.list('**/*').length, 2);
  assert.ok(few.skipped().some((s) => s.reason === 'file_limit'));
  const shallow = createFiles(root, { ...FILE_LIMITS, maxDepth: 1 });
  assert.ok(!shallow.api.list('**/*').includes('src/deep/b.css'));
  assert.ok(shallow.skipped().some((s) => s.reason === 'too_deep'));
});

test('list is sorted, deterministic and supports **, *, ?, {a,b} and ! exclusion', () => {
  const { root } = checkout();
  const { api } = createFiles(root);
  assert.deepEqual(api.list('src/**/*.css'), ['src/a.css', 'src/deep/b.css']);
  assert.deepEqual(api.list('src/*.css'), ['src/a.css']);
  assert.deepEqual(api.list('src/?.css'), ['src/a.css']);
  assert.deepEqual(api.list(['**/*.{css,html}', '!src/deep/**']), ['public/index.html', 'src/a.css']);
  assert.deepEqual(api.list('**/*'), [...api.list('**/*')].sort());
  assert.deepEqual(api.list('nothing/**'), []);
});

test('hostile globs are rejected, not run', () => {
  for (const g of ['', '/abs/**', '../**', 'a/../b', 'a*'.repeat(9), '{a,{b,{c,{d,e}}}}', '{unclosed', 'x'.repeat(201), 5]) {
    assert.throws(() => globToRegExp(g), TypeError, String(g).slice(0, 30));
  }
  const { api } = createFiles(checkout().root);
  assert.throws(() => api.list([]), TypeError);
  assert.throws(() => api.list(Array(51).fill('a')), TypeError);
  const re = globToRegExp('**/*.{css,scss}');
  assert.ok(re.test('a/b/c.css'));
  assert.ok(!re.test('a/b/c.cssx'));
});

test('the API cannot write: it exposes only list, read and exists', () => {
  const { api } = createFiles(checkout().root);
  assert.deepEqual(Object.keys(api).sort(), ['exists', 'list', 'read']);
  assert.ok(Object.isFrozen(api));
  mkdirSync(join(tmp(), 'unused'));
});
