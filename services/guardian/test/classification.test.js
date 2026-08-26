import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchHealth, normalizeChecks } from '../src/health.js';
import { reconcile, severityFor } from '../src/detect.js';
import { evaluate } from '../src/decide.js';
import { recordReachability, reachabilityFor } from '../src/store.js';
import { fakeFetch, manifest, tempStore } from './helpers.js';

const env = { TEST_GUARDIAN_TOKEN: 'tok' };

function respond(status) {
  return fakeFetch({
    'https://mines.test': () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({}),
    }),
  });
}

test('an HTTP status is classified by what it actually means', async () => {
  const cases = [
    [401, 'access'],
    [403, 'access'],
    [404, 'config'],
    [500, 'platform_error'],
    [502, 'platform_error'],
    [503, 'maintenance'],
  ];

  for (const [status, expected] of cases) {
    const result = await fetchHealth(manifest(), respond(status), env);
    assert.equal(result.reachable, false, `HTTP ${status} should not be reachable`);
    assert.equal(result.kind, expected, `HTTP ${status} should classify as ${expected}`);
  }
});

test('nothing answering is unreachable; a bad body is a contract failure', async () => {
  const threw = await fetchHealth(manifest(), fakeFetch({}), env);
  assert.equal(threw.kind, 'unreachable');

  const notJson = await fetchHealth(manifest(), fakeFetch({
    'https://mines.test': () => ({ ok: true, status: 200, json: async () => { throw new Error('nope'); } }),
  }), env);
  assert.equal(notJson.kind, 'contract');

  const wrongShape = await fetchHealth(manifest(), fakeFetch({
    'https://mines.test': () => ({ ok: true, status: 200, json: async () => ({ hello: 'world' }) }),
  }), env);
  assert.equal(wrongShape.kind, 'contract');
});

test('a missing token is a configuration fault, not an outage', async () => {
  const result = await fetchHealth(manifest(), respond(200), {});
  assert.equal(result.kind, 'config');
});

test('403 reports as access, never as availability', () => {
  const checks = normalizeChecks({ reachable: false, kind: 'access', reason: 'HTTP 403' });

  assert.ok(checks.access, 'should report an access check');
  assert.equal(checks.availability, undefined, 'must not claim the platform is unavailable');
  assert.equal(checks.access.status, 'warning');
  assert.match(checks.access.message, /reachable/);
});

test('an access failure can never reach sev1', () => {
  // The regression this whole change exists for: four sev1 "platform or
  // database unreachable" pages that were HTTP 403s from a WAF.
  assert.equal(severityFor('access', 'warning'), 'sev3');
  assert.equal(severityFor('access', 'critical'), 'sev2');
  assert.equal(severityFor('maintenance', 'warning'), 'sev3');
  assert.equal(severityFor('contract', 'warning'), 'sev3');
  assert.equal(severityFor('availability', 'critical'), 'sev1');
});

test('a single failed poll does not open an availability incident', () => {
  const store = tempStore();
  const down = { reachable: false, kind: 'unreachable', reason: 'fetch failed: timeout' };

  const first = reconcile(store, manifest(), down, new Date(), { failureStreak: 1, availabilityThreshold: 2 });
  assert.equal(first.opened.length, 0, 'one blip is not an outage');

  const second = reconcile(store, manifest(), down, new Date(), { failureStreak: 2, availabilityThreshold: 2 });
  assert.equal(second.opened.length, 1, 'a sustained failure is');
  assert.equal(second.opened[0].severity, 'sev1');
  assert.equal(second.opened[0].check_key, 'availability');
});

test('a 403 opens an access incident immediately, and it only recommends', () => {
  // Not gated: an access failure is real the first time it happens. It just
  // is not an outage, so it must not escalate.
  const store = tempStore();
  const { opened } = reconcile(store, manifest(), {
    reachable: false, kind: 'access', reason: 'HTTP 403',
  }, new Date(), { failureStreak: 1, availabilityThreshold: 2 });

  assert.equal(opened.length, 1);
  assert.equal(opened[0].check_key, 'access');
  assert.equal(opened[0].severity, 'sev3');

  const decision = evaluate({ incident: opened[0], manifest: manifest({ autonomy_level: 2 }) });
  assert.notEqual(decision.action, 'escalate', 'a WAF blip must not page a human at sev1');
});

test('the failure streak counts consecutive failures and a success resets it', () => {
  const store = tempStore();

  assert.equal(recordReachability(store, 'dot-mines', { ok: false, kind: 'unreachable' }), 1);
  assert.equal(recordReachability(store, 'dot-mines', { ok: false, kind: 'unreachable' }), 2);
  assert.equal(recordReachability(store, 'dot-mines', { ok: false, kind: 'access' }), 3);
  assert.equal(reachabilityFor(store, 'dot-mines').last_kind, 'access');

  assert.equal(recordReachability(store, 'dot-mines', { ok: true }), 0);
  assert.equal(reachabilityFor(store, 'dot-mines').consecutive_failures, 0);

  // Streaks are per platform.
  assert.equal(recordReachability(store, 'dot-memory', { ok: false, kind: 'unreachable' }), 1);
  assert.equal(recordReachability(store, 'dot-mines', { ok: false, kind: 'unreachable' }), 1);
});

test('maintenance is gated too, so a deploy does not raise an incident', () => {
  // Our own deploy returns 503 from `artisan down` for a minute or two.
  const store = tempStore();
  const inMaintenance = { reachable: false, kind: 'maintenance', reason: 'HTTP 503' };

  const during = reconcile(store, manifest(), inMaintenance, new Date(), { failureStreak: 1, availabilityThreshold: 2 });
  assert.equal(during.opened.length, 0);

  const stuck = reconcile(store, manifest(), inMaintenance, new Date(), { failureStreak: 2, availabilityThreshold: 2 });
  assert.equal(stuck.opened.length, 1, 'but maintenance that never ends is worth saying');
  assert.equal(stuck.opened[0].check_key, 'maintenance');
  assert.equal(stuck.opened[0].severity, 'sev3');
});

test('recovery closes an availability incident that the streak had opened', () => {
  const store = tempStore();
  const down = { reachable: false, kind: 'unreachable', reason: 'fetch failed: timeout' };

  reconcile(store, manifest(), down, new Date(), { failureStreak: 2, availabilityThreshold: 2 });

  const backUp = reconcile(store, manifest(), {
    reachable: true,
    status: 'healthy',
    checks: { availability: { status: 'healthy', message: '', metrics: {} } },
  }, new Date());

  assert.equal(backUp.resolved.length, 1);
});
