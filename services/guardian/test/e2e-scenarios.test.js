import test from 'node:test';
import assert from 'node:assert/strict';
import { runPoll } from '../src/guardian.js';
import {
  breakerFor,
  getIncident,
  listEscalations,
  listIncidents,
  listMemoryOutbox,
} from '../src/store.js';
import { fakeFetch, fakeRun, healthDoc, jsonResponse, manifest, noSleep, tempStore } from './helpers.js';

const ENV = {
  TEST_GUARDIAN_TOKEN: 'tok',
  DOT_MEMORY_URL: 'https://memory.test',
  DOT_MEMORY_TOKEN: 'memtok',
};

/**
 * A programmable world: a platform whose health you can flip between
 * polls, a Dot.Memory that answers recall with canned history, and a
 * fake gh/git.
 */
function world({ checks, recallData = { matches: 0 }, memoryDown = false }) {
  const state = { checks };
  const memoryWrites = [];
  const fetchImpl = fakeFetch({
    'https://mines.test/guardian/health': () => jsonResponse(healthDoc(state.checks)),
    'https://memory.test/api/ops/recall': () => (memoryDown ? jsonResponse({}, 503) : jsonResponse({ data: recallData })),
    'https://memory.test/api/ops/incidents': (url, options) => {
      if (memoryDown) {
        return jsonResponse({}, 503);
      }
      memoryWrites.push(JSON.parse(options.body));
      return jsonResponse({ data: {} }, 201);
    },
  });
  return { state, fetchImpl, memoryWrites };
}

function pollDeps(store, w, run, manifestOverrides = {}) {
  return {
    store,
    manifests: [manifest(manifestOverrides)],
    fetchImpl: w.fetchImpl,
    run,
    env: ENV,
    sleepImpl: noSleep,
  };
}

test('scenario: database down -> sev1 incident, escalated to a human, no code change attempted', async () => {
  const store = tempStore();
  const w = world({ checks: { database: { status: 'critical' }, queue: { status: 'healthy' } } });
  const run = fakeRun([
    { match: (cmd, args) => cmd === 'gh' && args[0] === 'issue', stdout: 'https://github.com/x/issues/7\n' },
  ]);

  const summary = await runPoll(pollDeps(store, w, run));

  assert.equal(summary[0].opened, 1);
  const incident = listIncidents(store)[0];
  assert.equal(incident.severity, 'sev1');
  assert.equal(incident.status, 'escalated');
  assert.equal(listEscalations(store).length, 1);
  assert.equal(run.find('workflow run').length, 0, 'no deploy for an infrastructure incident');
  assert.equal(run.find('issue create').length, 1);
  assert.ok(w.memoryWrites.some((write) => write.status === 'escalated'));
});

test('scenario: Bell sync stale at level 3 with known fix -> auto redeploy, verify, resolve, record', async () => {
  const store = tempStore();
  const w = world({
    checks: { integration_sync: { status: 'critical' }, database: { status: 'healthy' } },
    recallData: { matches: 3, success_rate: 0.9, rolled_back: 0 },
  });
  const run = fakeRun([
    { match: (cmd, args) => cmd === 'gh' && args[0] === 'api', stdout: 'sha1\n' },
  ]);

  // After the deploy triggers, the next verification poll sees it healthy.
  const originalFetch = w.fetchImpl;
  let deployed = false;
  const fetchImpl = async (url, options) => {
    if (String(url).includes('/guardian/health') && deployed) {
      return jsonResponse(healthDoc({ integration_sync: { status: 'healthy' }, database: { status: 'healthy' } }));
    }
    return originalFetch(url, options);
  };
  const deps = { ...pollDeps(store, w, run), fetchImpl };
  const trackedRun = async (cmd, args) => {
    const result = await run(cmd, args);
    if (cmd === 'gh' && args[0] === 'workflow') {
      deployed = true;
    }
    return result;
  };
  deps.run = trackedRun;

  const summary = await runPoll(deps);

  assert.equal(summary[0].actions[0].action, 'auto_remediate');
  assert.equal(summary[0].actions[0].verified, true);
  const incident = listIncidents(store)[0];
  assert.equal(incident.status, 'resolved');
  assert.equal(incident.attempts, 1);
  assert.equal(run.find('workflow run deploy.yml').length, 1);
  assert.ok(w.memoryWrites.some((write) => write.status === 'resolved' && write.validation_result === 'healthy'));
});

test('scenario: ingestion stopped at level 2 -> recommendation issue, no deploy, no merge', async () => {
  const store = tempStore();
  const w = world({
    checks: { telemetry_ingestion: { status: 'critical' } },
    recallData: { matches: 5, success_rate: 1, rolled_back: 0 },
  });
  const run = fakeRun([
    { match: (cmd, args) => cmd === 'gh' && args[0] === 'issue', stdout: 'https://github.com/x/issues/8\n' },
  ]);

  const summary = await runPoll(pollDeps(store, w, run, { autonomy_level: 2 }));

  assert.equal(summary[0].actions[0].action, 'recommend');
  assert.equal(run.find('issue create').length, 1);
  assert.equal(run.find('workflow run').length, 0);
  assert.equal(run.find('pr merge').length, 0);
  assert.equal(listIncidents(store)[0].status, 'open');

  // Second poll with the problem still present: no duplicate issue.
  await runPoll(pollDeps(store, w, run, { autonomy_level: 2 }));
  assert.equal(run.find('issue create').length, 1, 'recommendation issue must not duplicate');
  assert.equal(listIncidents(store).length, 1, 'incident must dedupe');
});

test('scenario: broken deploy -> verification fails, rollback, second failure opens the breaker and escalates', async () => {
  const store = tempStore();
  const w = world({
    checks: { integration_sync: { status: 'critical' } },
    recallData: { matches: 3, success_rate: 0.9, rolled_back: 0 },
  });
  const run = fakeRun([
    { match: (cmd, args) => cmd === 'gh' && args[0] === 'api', stdout: 'sha1\n' },
    { match: (cmd, args) => cmd === 'gh' && args[0] === 'issue', stdout: 'https://github.com/x/issues/9\n' },
  ]);

  // Attempt #1: deploy runs, health never recovers -> verification fails.
  let summary = await runPoll(pollDeps(store, w, run));
  assert.equal(summary[0].actions[0].verified, false);
  let incident = listIncidents(store)[0];
  assert.equal(incident.status, 'open', 'incident stays open after failed verification');
  assert.equal(incident.attempts, 1);
  assert.equal(breakerFor(store, 'dot-mines').consecutive_failures, 1);
  assert.ok(w.memoryWrites.some((write) => write.validation_result === 'failed'));

  // Attempt #2: same story -> attempts exhausted AND breaker opens.
  summary = await runPoll(pollDeps(store, w, run));
  assert.equal(summary[0].actions[0].verified, false);
  incident = listIncidents(store)[0];
  assert.equal(incident.attempts, 2);
  assert.equal(breakerFor(store, 'dot-mines').state, 'open');

  // Poll #3: escalates instead of attempting a third fix.
  summary = await runPoll(pollDeps(store, w, run));
  assert.equal(summary[0].actions[0].action, 'escalate');
  assert.equal(getIncident(store, incident.incident_uid).status, 'escalated');
  assert.equal(run.find('workflow run deploy.yml').length, 2, 'exactly two remediation deploys, never a third');
  assert.equal(listEscalations(store).filter((row) => row.reason.includes('breaker') || row.reason.includes('attempts')).length, 1);
});

test('scenario: Dot.Memory down -> detection still works and writes queue in the outbox, then flush drains them', async () => {
  const store = tempStore();
  const w = world({
    checks: { queue: { status: 'critical' } },
    memoryDown: true,
  });
  const run = fakeRun([
    { match: (cmd, args) => cmd === 'gh' && args[0] === 'issue', stdout: 'https://github.com/x/issues/10\n' },
  ]);

  const summary = await runPoll(pollDeps(store, w, run, { autonomy_level: 2 }));

  assert.equal(summary[0].opened, 1, 'detection unaffected by Dot.Memory outage');
  assert.ok(listMemoryOutbox(store).length >= 1, 'failed writes queue locally');

  // Memory comes back; the next poll's flush drains the outbox.
  const recovered = world({ checks: { queue: { status: 'healthy' } } });
  await runPoll(pollDeps(store, recovered, run, { autonomy_level: 2 }));
  assert.equal(listMemoryOutbox(store).length, 0, 'outbox drained once Dot.Memory recovered');
});

test('scenario: platform recovers on its own -> incident resolves and is recorded', async () => {
  const store = tempStore();
  const w = world({ checks: { queue: { status: 'critical' } } });
  const run = fakeRun([
    { match: (cmd, args) => cmd === 'gh' && args[0] === 'issue', stdout: 'https://github.com/x/issues/11\n' },
  ]);

  await runPoll(pollDeps(store, w, run, { autonomy_level: 1 }));
  assert.equal(listIncidents(store)[0].status, 'open');
  assert.equal(run.calls.length, 0, 'level 1 takes no action at all');

  w.state.checks = { queue: { status: 'healthy' } };
  const summary = await runPoll(pollDeps(store, w, run, { autonomy_level: 1 }));

  assert.equal(summary[0].resolved, 1);
  assert.equal(listIncidents(store)[0].status, 'resolved');
  assert.ok(w.memoryWrites.some((write) => write.status === 'resolved'));
});
