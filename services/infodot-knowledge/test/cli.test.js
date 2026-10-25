// The real entry point, as a subprocess, against a real HTTP server on loopback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verify } from '../src/hmac.js';
import { SECRET, TOKEN, item } from './_fixtures.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function start() {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/api/knowledge/candidates')) {
      const ok = verify(SECRET, { timestamp: req.headers['x-infodot-timestamp'], signature: req.headers['x-infodot-signature'] });
      if (!ok) { res.statusCode = 401; return res.end('{"code":"bad_signature","message":"no"}'); }
      return res.end(JSON.stringify({ items: [item()], next_since: null }));
    }
    if (req.url.startsWith('/api/knowledge-recommendations/outcomes')) return res.end('{"items":[]}');
    if (req.url === '/api/intelligence/decisions') { res.statusCode = 201; return res.end('{}'); }
    res.statusCode = 404;
    return res.end('{}');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}

function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { PATH: process.env.PATH, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('the CLI dry-runs against a live signed endpoint: exit 0, counts only, no POST', async () => {
  const { server, seen, url } = await start();
  try {
    const env = { INFODOT_URL: url, DOT_MEMORY_URL: url, KNOWLEDGE_SECRET_BRAIN: SECRET, DOT_MEMORY_TOKEN: TOKEN };
    const r = await run(['run'], env);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /mode: dry-run/);
    assert.match(r.stdout, /recommend_for_library 1/);
    assert.equal(seen.filter((s) => s.method === 'POST').length, 0);
    assert.ok(!(r.stdout + r.stderr).includes(SECRET));
  } finally {
    server.close();
  }
});

test('--apply posts the decision; a wrong secret fails the run closed without writing', async () => {
  const { server, seen, url } = await start();
  try {
    const env = { INFODOT_URL: url, DOT_MEMORY_URL: url, KNOWLEDGE_SECRET_BRAIN: SECRET, DOT_MEMORY_TOKEN: TOKEN };
    const ok = await run(['run', '--apply'], env);
    assert.equal(ok.code, 0, ok.stderr);
    const posts = seen.filter((s) => s.method === 'POST');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].headers.authorization, `Bearer ${TOKEN}`);

    const before = seen.length;
    const bad = await run(['run', '--apply'], { ...env, KNOWLEDGE_SECRET_BRAIN: 'a-different-secret-value' });
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /401/);
    assert.equal(seen.slice(before).filter((s) => s.method === 'POST').length, 0);
    assert.ok(!(bad.stdout + bad.stderr).includes('a-different-secret-value'));
  } finally {
    server.close();
  }
});

test('with nothing configured the CLI exits non-zero and says which variables', async () => {
  const r = await run(['run', '--apply'], {});
  assert.equal(r.code, 1);
  assert.match(r.stderr, /INFODOT_URL/);
  assert.match(r.stderr, /KNOWLEDGE_SECRET_BRAIN/);
});
