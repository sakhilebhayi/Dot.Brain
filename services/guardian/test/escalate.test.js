import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recommend } from '../src/escalate.js';
import { fakeRun, manifest, tempStore } from './helpers.js';

function incident(overrides = {}) {
  return {
    incident_uid: 'grd-test-esc-1',
    platform: 'dot-mines',
    check_key: 'provider_data_freshness',
    signature: 'dot-mines:provider_data_freshness:warning',
    severity: 'sev3',
    status: 'open',
    attempts: 0,
    first_seen: new Date().toISOString(),
    detail: { check: 'provider_data_freshness', health: { status: 'warning', message: '', metrics: {} } },
    ...overrides,
  };
}

function issueBodyFrom(run) {
  const call = run.find('issue create')[0];
  const bodyFile = call.args[call.args.indexOf('--body-file') + 1];
  return readFileSync(bodyFile, 'utf8');
}

test('an advisory recommendation prints the advice, not a deploy-workflow approval', async () => {
  const store = tempStore();
  const run = fakeRun([
    { match: (cmd, args) => cmd === 'gh' && args[0] === 'issue', stdout: 'https://github.com/x/1\n' },
  ]);

  await recommend({
    store,
    manifest: manifest(),
    incident: incident(),
    decision: {
      action: 'recommend',
      runbook: {
        key: 'contact_provider',
        kind: 'advisory',
        risk: 0,
        description: 'Check the provider portal and raise it with the manufacturer.',
      },
      confidence: 0.5,
      risk: 0,
      reasons: ['advisory runbook: no automated action exists'],
    },
    recall: { matches: 0 },
    run,
  });

  const body = issueBodyFrom(run);
  assert.match(body, /provider portal/i);
  assert.doesNotMatch(body, /re-run `deploy\.yml`/);
});
