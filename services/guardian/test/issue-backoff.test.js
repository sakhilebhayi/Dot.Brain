import test from 'node:test';
import assert from 'node:assert/strict';
import { runPoll } from '../src/guardian.js';
import { issueRetryDelayMs, listEscalations } from '../src/store.js';
import { fakeFetch, healthDoc, jsonResponse, manifest, noSleep, tempStore } from './helpers.js';

const ENV = { TEST_GUARDIAN_TOKEN: 'tok' };
const MIN = 60 * 1000;

function setup(checks) {
  const store = tempStore();
  const fetchImpl = fakeFetch({ 'https://mines.test/guardian/health': () => jsonResponse(healthDoc(checks)) });
  const logs = [];
  let clock = Date.parse('2026-10-17T12:00:00Z');
  const calls = [];
  const behaviour = { fail: true };
  const run = async (cmd, args) => {
    calls.push([cmd, args[0]]);
    if (behaviour.fail) {
      const error = new Error('Command failed: gh issue create -R sakhilebhayi/Dot.Mines --title x');
      error.stderr = 'GraphQL: Resource not accessible by personal access token (createIssue)\n';
      throw error;
    }
    return { stdout: 'https://github.com/sakhilebhayi/Dot.Mines/issues/9\n', stderr: '' };
  };
  const poll = () => runPoll({
    store, manifests: [manifest({ autonomy_level: 2 })], fetchImpl, run, env: ENV, sleepImpl: noSleep,
    now: () => new Date(clock), log: (line) => logs.push(line),
  });
  return { store, poll, logs, calls, behaviour, advance: (ms) => { clock += ms; } };
}

test('the retry delay doubles from 30 minutes and is capped at 6 hours', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map((n) => issueRetryDelayMs(n) / MIN), [30, 60, 120, 240, 360, 360, 360]);
});

test('a failed advice issue is retried with a growing delay, not on every poll', async () => {
  const w = setup({ queue: { status: 'critical' } });

  const first = await w.poll();
  assert.equal(first[0].actions[0].attempts, 1);
  assert.match(first[0].actions[0].issue_error, /Resource not accessible/);
  assert.equal(w.calls.length, 1);
  assert.match(w.logs.join('\n'), /Check that GUARDIAN_GH_TOKEN can create issues in sakhilebhayi\/Dot\.Mines/);
  assert.match(w.logs.join('\n'), /Next attempt in 30 min/);

  // Six more 5-minute polls inside the 30 minute window must not call gh.
  for (let i = 0; i < 5; i += 1) {
    w.advance(5 * MIN);
    const again = await w.poll();
    assert.equal(again[0].actions[0].issue, 'retry-later');
  }
  assert.equal(w.calls.length, 1, 'no gh call while the backoff is running');

  // Past 30 minutes it tries again, and the delay doubles to 60.
  w.advance(6 * MIN);
  const second = await w.poll();
  assert.equal(second[0].actions[0].attempts, 2);
  assert.equal(w.calls.length, 2);
  assert.match(w.logs.at(-1), /Next attempt in 60 min/);
});

test('once the token works the issue is opened and later polls report it already open', async () => {
  const w = setup({ queue: { status: 'critical' } });
  await w.poll();
  w.behaviour.fail = false;
  w.advance(31 * MIN);

  const opened = await w.poll();
  assert.equal(opened[0].actions[0].issue, 'https://github.com/sakhilebhayi/Dot.Mines/issues/9');
  assert.equal(listEscalations(w.store).length, 1);

  w.advance(5 * MIN);
  const next = await w.poll();
  assert.equal(next[0].actions[0].issue, 'already-open');
  assert.equal(w.calls.length, 2, 'no further gh calls once the issue exists');
});

test('a failing ESCALATION is never backed off: it retries on every poll', async () => {
  const w = setup({ database: { status: 'critical' } });

  const first = await w.poll();
  w.advance(5 * MIN);
  const second = await w.poll();

  assert.ok(first[0].actions[0].error);
  assert.ok(second[0].actions[0].error);
  assert.equal(w.calls.length, 2, 'a human must know, so every poll tries again');
});
