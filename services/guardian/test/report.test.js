import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summarize, writeReport } from '../src/report.js';
import {
  insertIncident,
  recordDeployment,
  recordEscalation,
  setIncidentStatus,
  incrementAttempts,
} from '../src/store.js';
import { tempStore } from './helpers.js';

function seed(store) {
  const openIncident = insertIncident(store, {
    incident_uid: 'grd-a', platform: 'dot-mines', check_key: 'queue',
    signature: 'dot-mines:queue:critical', severity: 'sev2', detail: null,
  }, new Date('2026-08-25T10:00:00Z'));

  const fixed = insertIncident(store, {
    incident_uid: 'grd-b', platform: 'dot-mines', check_key: 'integration_sync',
    signature: 'dot-mines:integration_sync:critical', severity: 'sev2', detail: null,
  }, new Date('2026-08-25T09:00:00Z'));
  incrementAttempts(store, 'grd-b');
  setIncidentStatus(store, 'grd-b', 'resolved', new Date('2026-08-25T09:30:00Z'));

  insertIncident(store, {
    incident_uid: 'grd-c', platform: 'dot-mines', check_key: 'database',
    signature: 'dot-mines:database:critical', severity: 'sev1', detail: null,
  });
  setIncidentStatus(store, 'grd-c', 'escalated');

  recordDeployment(store, { platform: 'dot-mines', incident_uid: 'grd-b', kind: 'deploy', workflow: 'deploy.yml' });
  recordDeployment(store, { platform: 'dot-mines', incident_uid: 'grd-b', kind: 'rollback', workflow: 'deploy.yml' });
  recordEscalation(store, { incident_uid: 'grd-c', platform: 'dot-mines', reason: 'sev1', issue_url: 'https://github.com/x/issues/1' });

  return openIncident;
}

test('summarize computes the dashboard totals', () => {
  const store = tempStore();
  seed(store);

  const summary = summarize(store);

  assert.equal(summary.totals.incidents, 3);
  assert.equal(summary.totals.active, 1);
  assert.equal(summary.totals.resolved, 1);
  assert.equal(summary.totals.escalated, 1);
  assert.equal(summary.totals.auto_fixed, 1);
  assert.equal(summary.totals.rollbacks, 1);
  assert.equal(summary.totals.escalations, 1);
  assert.equal(summary.totals.success_rate, 1);
  assert.equal(summary.totals.mttr_minutes, 30);
});

test('writeReport renders a self-contained html dashboard', () => {
  const store = tempStore();
  seed(store);
  const out = join(mkdtempSync(join(tmpdir(), 'guardian-report-')), 'index.html');

  writeReport(store, out);
  const html = readFileSync(out, 'utf8');

  assert.match(html, /Dot Guardian/);
  assert.match(html, /grd-a/);
  assert.match(html, /dot-mines:queue:critical/);
  assert.match(html, /github\.com\/x\/issues\/1/);
  assert.doesNotMatch(html, /<script src=|https:\/\/cdn/);
});
