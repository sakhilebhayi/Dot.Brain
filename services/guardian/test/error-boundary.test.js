import test from 'node:test';
import assert from 'node:assert/strict';
import { runPoll } from '../src/guardian.js';
import { listIncidents } from '../src/store.js';
import { fakeFetch, healthDoc, jsonResponse, manifest, noSleep, tempStore } from './helpers.js';

const ENV = { TEST_GUARDIAN_TOKEN: 'tok' };

test('one failed action does not abort the rest of the poll', async () => {
  const store = tempStore();
  const fetchImpl = fakeFetch({
    'https://mines.test/guardian/health': () => jsonResponse(healthDoc({
      telemetry_ingestion: { status: 'critical' },
      queue: { status: 'critical' },
    })),
  });
  // gh is completely unavailable: every recommendation attempt throws.
  const run = async () => {
    throw new Error('gh: command not found');
  };

  const summary = await runPoll({
    store,
    manifests: [manifest({ autonomy_level: 2 })],
    fetchImpl,
    run,
    env: ENV,
    sleepImpl: noSleep,
  });

  assert.equal(summary[0].opened, 2, 'both incidents still open despite gh being down');
  assert.equal(summary[0].actions.filter((action) => action.error).length, 2);
  assert.equal(listIncidents(store).length, 2, 'detection recorded both incidents');
});
