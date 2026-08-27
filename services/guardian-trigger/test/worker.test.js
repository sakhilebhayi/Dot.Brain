import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { dispatchGuardianPoll } from '../src/worker.js';

function fakeFetch(status, body = '') {
  const impl = async (url, init) => {
    impl.calls.push({ url, init });
    return { status, text: async () => body };
  };
  impl.calls = [];
  return impl;
}

test('dispatches the guardian workflow on main with the token', async () => {
  const fetchImpl = fakeFetch(204);

  await dispatchGuardianPoll({ token: 'gh-token', fetchImpl });

  assert.equal(fetchImpl.calls.length, 1);
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, 'https://api.github.com/repos/sakhilebhayi/Dot.Brain/actions/workflows/guardian-cron.yml/dispatches');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer gh-token');
  assert.deepEqual(JSON.parse(init.body), { ref: 'main' });
});

test('a non-204 response throws so the failure is visible in Cloudflare metrics', async () => {
  const fetchImpl = fakeFetch(401, 'Bad credentials');

  await assert.rejects(
    dispatchGuardianPoll({ token: 'expired', fetchImpl }),
    /401.*Bad credentials/s,
  );
});

test('a missing token throws before any request leaves', async () => {
  const fetchImpl = fakeFetch(204);

  await assert.rejects(dispatchGuardianPoll({ token: '', fetchImpl }), /GITHUB_TOKEN/);
  assert.equal(fetchImpl.calls.length, 0);
});

test('the scheduled handler wires the env secret through', async () => {
  const fetchImpl = fakeFetch(204);

  await worker.scheduled({}, { GITHUB_TOKEN: 'env-token' }, {}, fetchImpl);

  assert.equal(fetchImpl.calls[0].init.headers.Authorization, 'Bearer env-token');
});
