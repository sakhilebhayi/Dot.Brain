import test from 'node:test';
import assert from 'node:assert/strict';
import { execute, rollback } from '../src/remediate.js';
import { getIncident, insertIncident, lastDeployment, recordDeployment } from '../src/store.js';
import { fakeRun, manifest, tempStore } from './helpers.js';

function seedIncident(store, overrides = {}) {
  return insertIncident(store, {
    incident_uid: 'grd-dot-mines-20260825-0001',
    platform: 'dot-mines',
    check_key: 'queue',
    signature: 'dot-mines:queue:critical',
    severity: 'sev2',
    detail: { check: 'queue' },
    ...overrides,
  });
}

function decisionFor(runbook) {
  return { action: 'auto_remediate', runbook, confidence: 0.8, risk: runbook.risk, reasons: ['test'] };
}

test('workflow runbook triggers the platform deploy workflow with confirm inputs', async () => {
  const store = tempStore();
  const incident = seedIncident(store);
  const run = fakeRun([
    { match: (cmd, args) => cmd === 'gh' && args[0] === 'api', stdout: 'abc123\n' },
  ]);

  const result = await execute({
    incident,
    decision: decisionFor({ key: 'redeploy', kind: 'workflow', risk: 0.2, description: '' }),
    manifest: manifest(),
    store,
    run,
  });

  assert.equal(result.deployed, true);
  const workflowCall = run.find('workflow run deploy.yml');
  assert.equal(workflowCall.length, 1);
  assert.deepEqual(workflowCall[0].args, [
    'workflow', 'run', 'deploy.yml', '-R', 'sakhilebhayi/Dot.Mines', '-f', 'confirm=deploy',
  ]);

  const deployment = lastDeployment(store, 'dot-mines');
  assert.equal(deployment.kind, 'deploy');
  assert.equal(deployment.pre_sha, 'abc123');
  assert.equal(getIncident(store, incident.incident_uid).attempts, 1);
  assert.equal(getIncident(store, incident.incident_uid).status, 'remediating');
});

test('revert_pr runbook clones, reverts, pushes, opens a PR, waits for CI, merges, deploys', async () => {
  const store = tempStore();
  recordDeployment(store, {
    platform: 'dot-mines', kind: 'deploy', workflow: 'deploy.yml', pre_sha: 'aaa', head_sha: 'bbb',
  });
  const incident = seedIncident(store, { check_key: 'error_rate', signature: 'dot-mines:error_rate:critical' });
  const run = fakeRun([
    { match: (cmd, args) => cmd === 'gh' && args[0] === 'pr' && args[1] === 'create', stdout: 'https://github.com/x/pull/9\n' },
    { match: (cmd, args) => cmd === 'gh' && args[0] === 'api', stdout: 'sha\n' },
  ]);

  const result = await execute({
    incident,
    decision: decisionFor({ key: 'rollback_last_deploy', kind: 'revert_pr', risk: 0.5, description: '' }),
    manifest: manifest(),
    store,
    run,
  });

  assert.equal(result.pr_url, 'https://github.com/x/pull/9');
  assert.equal(result.deployed, true);

  const sequence = run.calls.map((call) => `${call.cmd} ${call.args.slice(0, 2).join(' ')}`);
  assert.ok(sequence.some((entry) => entry.startsWith('gh repo')), 'clones the repo');
  assert.equal(run.find('revert --no-edit aaa..bbb').length, 1, 'reverts the recorded deploy range');
  assert.equal(run.find('pr checks').length, 1, 'waits for CI');
  assert.equal(run.find('pr merge').length, 1, 'merges after green CI');
  assert.equal(run.find('workflow run deploy.yml').length, 1, 'triggers the deploy workflow');

  const deployment = lastDeployment(store, 'dot-mines');
  assert.equal(deployment.kind, 'rollback');
});

test('revert_pr never merges when CI checks fail', async () => {
  const store = tempStore();
  recordDeployment(store, {
    platform: 'dot-mines', kind: 'deploy', workflow: 'deploy.yml', pre_sha: 'aaa', head_sha: 'bbb',
  });
  const incident = seedIncident(store, { check_key: 'error_rate' });
  const run = fakeRun([
    { match: (cmd, args) => cmd === 'gh' && args[0] === 'pr' && args[1] === 'create', stdout: 'https://github.com/x/pull/9\n' },
    { match: (cmd, args) => cmd === 'gh' && args[0] === 'pr' && args[1] === 'checks', error: 'checks failed' },
  ]);

  await assert.rejects(execute({
    incident,
    decision: decisionFor({ key: 'rollback_last_deploy', kind: 'revert_pr', risk: 0.5, description: '' }),
    manifest: manifest(),
    store,
    run,
  }), /checks failed/);

  assert.equal(run.find('pr merge').length, 0, 'must not merge on red CI');
  assert.equal(run.find('workflow run').length, 0, 'must not deploy on red CI');
});

test('rollback is a no-op when the last remediation shipped no code change', async () => {
  const store = tempStore();
  recordDeployment(store, {
    platform: 'dot-mines', kind: 'deploy', workflow: 'deploy.yml', pre_sha: 'same', head_sha: 'same',
  });
  const incident = seedIncident(store);
  const run = fakeRun();

  const result = await rollback({
    incident,
    decision: decisionFor({ key: 'redeploy', kind: 'workflow', risk: 0.2, description: '' }),
    manifest: manifest(),
    store,
    run,
  });

  assert.equal(result.rolledBack, false);
  assert.equal(run.calls.length, 0);
});

test('execute refuses an advisory runbook outright', async () => {
  const store = tempStore();
  const incident = seedIncident(store);
  const run = fakeRun();

  await assert.rejects(
    execute({
      incident,
      decision: decisionFor({ key: 'contact_provider', kind: 'advisory', risk: 0, description: 'advice only' }),
      manifest: manifest(),
      store,
      run,
    }),
    /advice, not an automated action/i,
  );
  assert.equal(run.calls.length, 0);
});
