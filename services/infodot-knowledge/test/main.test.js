import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv, REQUIRED_ENV } from '../src/env.js';
import { main, parseArgs } from '../src/main.js';
import { ENV, NOW, SECRET, TOKEN, item, noSleep, reply } from './_fixtures.js';

function harness({ candidates = [item()], memoryStatus = 201, throwOn } = {}) {
  const out = [];
  const err = [];
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET' });
    if (throwOn && url.includes(throwOn)) throw new Error(`connection reset, token=${TOKEN} secret=${SECRET}`);
    const u = new URL(url);
    if (u.host === 'infodot.test') return reply(200, { items: candidates, next_since: null });
    if (u.pathname.endsWith('/outcomes')) return reply(200, { items: [] });
    return reply(memoryStatus);
  };
  return {
    out, err, calls,
    deps: { out: (l) => out.push(l), err: (l) => err.push(l), fetchImpl, now: () => NOW, sleep: noSleep, delaysMs: [], write: () => {}, append: () => {} },
    posts: () => calls.filter((c) => c.method === 'POST'),
    text: () => [...out, ...err].join('\n'),
  };
}

test('fails closed when any of the four variables is unset: non-zero, names the variable, touches nothing', async () => {
  for (const name of REQUIRED_ENV) {
    const h = harness();
    const env = { ...ENV };
    delete env[name];
    const code = await main(['run', '--apply'], env, h.deps);
    assert.equal(code, 1, name);
    assert.equal(h.calls.length, 0, `${name}: no request of any kind`);
    assert.match(h.err.join('\n'), new RegExp(name));
  }
});

test('blank values count as unset, and the error never prints the values that are set', async () => {
  const h = harness();
  const code = await main(['run'], { ...ENV, DOT_MEMORY_TOKEN: '   ' }, h.deps);
  assert.equal(code, 1);
  assert.ok(!h.text().includes(SECRET));
  assert.ok(!h.text().includes(TOKEN));
});

test('non-https URLs are refused (loopback excepted)', () => {
  assert.deepEqual(loadEnv({ ...ENV, INFODOT_URL: 'http://infodot.co.za' }), { ok: false, missing: [], invalid: ['INFODOT_URL'] });
  assert.deepEqual(loadEnv({ ...ENV, DOT_MEMORY_URL: 'not a url' }), { ok: false, missing: [], invalid: ['DOT_MEMORY_URL'] });
  assert.equal(loadEnv({ ...ENV, INFODOT_URL: 'http://127.0.0.1:8080/' }).ok, true);
  assert.equal(loadEnv({ ...ENV, INFODOT_URL: 'https://infodot.test///' }).cfg.infodotUrl, 'https://infodot.test');
});

test('dry run is the default: reads happen, no POST ever', async () => {
  const h = harness();
  assert.equal(await main(['run'], ENV, h.deps), 0);
  assert.equal(await main(['run', '--dry-run'], ENV, h.deps), 0);
  assert.equal(h.posts().length, 0);
  assert.match(h.out.join('\n'), /mode: dry-run/);
  assert.match(h.out.join('\n'), /written: 0/);
});

test('--apply writes', async () => {
  const h = harness();
  assert.equal(await main(['run', '--apply'], ENV, h.deps), 0);
  assert.equal(h.posts().length, 1);
  assert.match(h.out.join('\n'), /mode: apply/);
});

test('--since and --limit are passed to InfoDot', async () => {
  const h = harness();
  await main(['run', '--since', '2026-05-01T00:00:00Z', '--limit', '25'], ENV, h.deps);
  const u = new URL(h.calls[0].url);
  assert.equal(u.searchParams.get('since'), '2026-05-01T00:00:00Z');
  assert.equal(u.searchParams.get('limit'), '25');
});

test('usage errors exit 2 before reading the environment or the network', async () => {
  for (const argv of [[], ['collect'], ['run', '--bogus'], ['run', '--dry-run', '--apply'], ['run', '--limit', '0'], ['run', '--limit', '101'],
    ['run', '--limit', 'x'], ['run', '--since', 'yesterday'], ['run', '--since'], ['run', '--summary-file']]) {
    const h = harness();
    assert.equal(await main(argv, ENV, h.deps), 2, argv.join(' '));
    assert.equal(h.calls.length, 0);
  }
  assert.equal(parseArgs(['run', '--limit', '100']).limit, 100);
});

test('a failed read exits 1 and says nothing was written', async () => {
  const h = harness({ throwOn: '/outcomes' });
  assert.equal(await main(['run', '--apply'], ENV, h.deps), 1);
  assert.equal(h.posts().length, 0);
  assert.match(h.err.join('\n'), /nothing was written/);
});

test('a failed write exits 1', async () => {
  const h = harness({ memoryStatus: 500 });
  assert.equal(await main(['run', '--apply'], ENV, h.deps), 1);
});

test('no secret or token ever appears in any output, even when the transport echoes them', async () => {
  for (const throwOn of ['infodot.test', '/outcomes', '/decisions']) {
    const h = harness({ throwOn });
    await main(['run', '--apply'], ENV, h.deps);
    const text = h.text();
    assert.ok(!text.includes(SECRET), `${throwOn}: secret leaked`);
    assert.ok(!text.includes(TOKEN), `${throwOn}: token leaked`);
  }
});

test('output is counts only and the job summary and summary file receive the same counts', async () => {
  const h = harness({ candidates: [item({ contribution_ref: 'ctr_private_ref' })] });
  const files = [];
  const deps = { ...h.deps, write: (p, c) => files.push(['write', p, c]), append: (p, c) => files.push(['append', p, c]) };
  assert.equal(await main(['run', '--summary-file', 'summary.json'], { ...ENV, GITHUB_STEP_SUMMARY: '/tmp/step' }, deps), 0);

  assert.ok(!h.text().includes('ctr_private_ref'));
  const [w, a] = files;
  assert.equal(w[1], 'summary.json');
  assert.equal(JSON.parse(w[2]).pulled, 1);
  assert.ok(!w[2].includes('ctr_private_ref'));
  assert.equal(a[1], '/tmp/step');
  assert.match(a[2], /InfoDot knowledge candidates/);
  assert.ok(!a[2].includes('ctr_private_ref'));
});

test('a failure to write the summary file is a warning, not a failed run', async () => {
  const h = harness();
  const deps = { ...h.deps, write: () => { throw new Error('read-only'); } };
  assert.equal(await main(['run', '--summary-file', '/nope/x.json'], ENV, deps), 0);
  assert.match(h.err.join('\n'), /warning/);
});
