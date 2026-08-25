import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, severityFor } from '../src/detect.js';
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
