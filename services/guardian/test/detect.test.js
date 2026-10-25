import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, severityFor } from '../src/detect.js';
import { SYNTHETIC_CHECK_KEYS } from '../src/health.js';
import { listIncidents } from '../src/store.js';
import { healthDoc, manifest, tempStore } from './helpers.js';

function reachable(checks) {
  const doc = healthDoc(checks);
  return { reachable: true, status: doc.status, checks: doc.checks };
}

test('severity mapping: infrastructure critical is sev1, other critical sev2, warning sev3', () => {
  assert.equal(severityFor('availability', 'critical'), 'sev1');
  assert.equal(severityFor('database', 'critical'), 'sev1');
  assert.equal(severityFor('queue', 'critical'), 'sev2');
  assert.equal(severityFor('queue', 'warning'), 'sev3');
});

test('opens one incident per failing check', () => {
  const store = tempStore();
  const { opened, ongoing, resolved } = reconcile(store, manifest(), reachable({
    database: { status: 'healthy' },
    queue: { status: 'critical' },
    integration_sync: { status: 'warning' },
  }));

  assert.equal(opened.length, 2);
  assert.equal(ongoing.length, 0);
  assert.equal(resolved.length, 0);

  const queueIncident = opened.find((incident) => incident.check_key === 'queue');
  assert.equal(queueIncident.severity, 'sev2');
  assert.equal(queueIncident.signature, 'dot-mines:queue:critical');
  assert.equal(queueIncident.status, 'open');
});

test('a repeat poll dedupes into the same incident', () => {
  const store = tempStore();
  const first = reconcile(store, manifest(), reachable({ queue: { status: 'critical' } }));
  const second = reconcile(store, manifest(), reachable({ queue: { status: 'critical' } }));

  assert.equal(first.opened.length, 1);
  assert.equal(second.opened.length, 0);
  assert.equal(second.ongoing.length, 1);
  assert.equal(second.ongoing[0].incident_uid, first.opened[0].incident_uid);
  assert.equal(listIncidents(store).length, 1);
});

test('warning escalating to critical upgrades severity in place', () => {
  const store = tempStore();
  const first = reconcile(store, manifest(), reachable({ queue: { status: 'warning' } }));
  assert.equal(first.opened[0].severity, 'sev3');

  const second = reconcile(store, manifest(), reachable({ queue: { status: 'critical' } }));
  assert.equal(second.ongoing[0].severity, 'sev2');
  assert.equal(second.ongoing[0].incident_uid, first.opened[0].incident_uid);
});

test('a healthy check closes its active incident', () => {
  const store = tempStore();
  reconcile(store, manifest(), reachable({ queue: { status: 'critical' } }));
  const { resolved } = reconcile(store, manifest(), reachable({ queue: { status: 'healthy' } }));

  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].status, 'resolved');
  assert.ok(resolved[0].resolved_at);
});

test('unknown neither opens nor closes', () => {
  const store = tempStore();
  reconcile(store, manifest(), reachable({ queue: { status: 'critical' } }));
  const result = reconcile(store, manifest(), reachable({ queue: { status: 'unknown' } }));

  assert.equal(result.opened.length, 0);
  assert.equal(result.resolved.length, 0);
  assert.equal(listIncidents(store)[0].status, 'open');
});

test('an unreachable platform becomes a sev1 availability incident', () => {
  const store = tempStore();
  const { opened } = reconcile(store, manifest(), { reachable: false, reason: 'HTTP 502' });

  assert.equal(opened.length, 1);
  assert.equal(opened[0].check_key, 'availability');
  assert.equal(opened[0].severity, 'sev1');
});

const WINDOW = { failureStreak: 2, failureElapsedMs: 20 * 60 * 1000, availabilityWindowMs: 600000 };

test('the synthetic check keys are exactly the ones a fetch failure can file under', () => {
  assert.deepEqual([...SYNTHETIC_CHECK_KEYS].sort(), ['access', 'availability', 'contract', 'maintenance']);
});

test('an access incident closes when the platform answers a valid document again', () => {
  const store = tempStore();
  const blip = reconcile(store, manifest(), { reachable: false, kind: 'access', reason: 'HTTP 403' }, new Date(), WINDOW);
  assert.equal(blip.opened.length, 1);
  assert.equal(blip.opened[0].check_key, 'access');

  const back = reconcile(store, manifest(), reachable({ database: { status: 'healthy' } }));

  assert.equal(back.resolved.length, 1, 'recovery must close the access incident');
  assert.equal(back.resolved[0].check_key, 'access');
  assert.equal(back.resolved[0].status, 'resolved');
  assert.ok(back.resolved[0].resolved_at);
  assert.equal(listIncidents(store).filter((incident) => incident.status === 'open').length, 0);
});

test('every synthetic incident kind closes on recovery, including a sev1 outage', () => {
  for (const [kind, key, severity] of [
    ['unreachable', 'availability', 'sev1'],
    ['platform_error', 'availability', 'sev1'],
    ['maintenance', 'maintenance', 'sev3'],
    ['contract', 'contract', 'sev3'],
    ['config', 'access', 'sev2'],
  ]) {
    const store = tempStore();
    const down = reconcile(store, manifest(), { reachable: false, kind, reason: 'x' }, new Date(), WINDOW);
    assert.equal(down.opened.length, 1, `${kind} should open`);
    assert.equal(down.opened[0].check_key, key);
    assert.equal(down.opened[0].severity, severity);

    const back = reconcile(store, manifest(), reachable({ queue: { status: 'healthy' } }));
    assert.equal(back.resolved.length, 1, `${kind} should close on recovery`);
    assert.equal(back.resolved[0].check_key, key);
  }
});

test('a still-unreachable platform does not close a synthetic incident', () => {
  const store = tempStore();
  reconcile(store, manifest(), { reachable: false, kind: 'access', reason: 'HTTP 403' }, new Date(), WINDOW);

  const still = reconcile(store, manifest(), { reachable: false, kind: 'access', reason: 'HTTP 403' }, new Date(), WINDOW);

  assert.equal(still.resolved.length, 0);
  assert.equal(still.ongoing.length, 1);
});

test('recovery closes the synthetic incident but leaves a genuinely failing platform check open', () => {
  const store = tempStore();
  reconcile(store, manifest(), { reachable: false, kind: 'access', reason: 'HTTP 403' }, new Date(), WINDOW);
  reconcile(store, manifest(), reachable({ queue: { status: 'critical' } }));

  const next = reconcile(store, manifest(), reachable({ queue: { status: 'critical' } }));

  assert.equal(next.resolved.length, 0, 'the access incident was already closed by the first reachable poll');
  assert.equal(next.ongoing.length, 1);
  assert.equal(next.ongoing[0].check_key, 'queue');
});

test('a platform check that shares a synthetic key name is judged by its own status', () => {
  const store = tempStore();
  const opened = reconcile(store, manifest(), reachable({ access: { status: 'warning' } }));
  assert.equal(opened.opened.length, 1);

  const stillBad = reconcile(store, manifest(), reachable({ access: { status: 'warning' } }));
  assert.equal(stillBad.resolved.length, 0, 'its own check says warning, so it stays open');

  const healed = reconcile(store, manifest(), reachable({ access: { status: 'healthy' } }));
  assert.equal(healed.resolved.length, 1);
});
