import test from 'node:test';
import assert from 'node:assert/strict';
import { postDeploy } from '../src/verify.js';
import { fakeFetch, healthDoc, jsonResponse, manifest, noSleep } from './helpers.js';

const ENV = { TEST_GUARDIAN_TOKEN: 'tok' };

test('verification succeeds when the remediated check comes back healthy', async () => {
  let poll = 0;
  const fetchImpl = fakeFetch({
    'https://mines.test/guardian/health': () => {
      poll += 1;
      return jsonResponse(healthDoc({
        queue: { status: poll >= 2 ? 'healthy' : 'critical' },
      }));
    },
  });

  const result = await postDeploy({
    manifest: manifest({ verification: { polls: 3, interval_s: 0 } }),
    checkKey: 'queue',
    fetchImpl,
    env: ENV,
    sleepImpl: noSleep,
  });

  assert.equal(result.ok, true);
  assert.equal(result.observations.length, 2);
});

test('verification fails when the check never recovers', async () => {
  const fetchImpl = fakeFetch({
    'https://mines.test/guardian/health': () => jsonResponse(healthDoc({ queue: { status: 'critical' } })),
  });

  const result = await postDeploy({
    manifest: manifest({ verification: { polls: 3, interval_s: 0 } }),
    checkKey: 'queue',
    fetchImpl,
    env: ENV,
    sleepImpl: noSleep,
  });

  assert.equal(result.ok, false);
  assert.equal(result.observations.length, 3);
});

test('verification fails when the fix helped its check but the platform went critical elsewhere', async () => {
  const fetchImpl = fakeFetch({
    'https://mines.test/guardian/health': () => jsonResponse(healthDoc({
      queue: { status: 'healthy' },
      database: { status: 'critical' },
    })),
  });

  const result = await postDeploy({
    manifest: manifest({ verification: { polls: 2, interval_s: 0 } }),
    checkKey: 'queue',
    fetchImpl,
    env: ENV,
    sleepImpl: noSleep,
  });

  assert.equal(result.ok, false);
});

test('an unreachable platform during verification counts as failure', async () => {
  const fetchImpl = fakeFetch({
    'https://mines.test/guardian/health': () => jsonResponse({}, 502),
  });

  const result = await postDeploy({
    manifest: manifest({ verification: { polls: 2, interval_s: 0 } }),
    checkKey: 'queue',
    fetchImpl,
    env: ENV,
    sleepImpl: noSleep,
  });

  assert.equal(result.ok, false);
  assert.equal(result.observations[0].overall, 'critical');
});
