import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  incrementAttempts,
  lastDeployment,
  recordDeployment,
  setIncidentStatus,
} from './store.js';
import { issueBody } from './escalate.js';

/**
 * Runbook execution. Every path goes through the platform's own GitHub
 * repo and existing CI/CD workflow -- the guardian has no other route into
 * production, by design.
 *
 * `run(cmd, args)` is injected (child_process in the CLI, a fake in
 * tests) and must resolve to { stdout } or throw on a non-zero exit.
 */

async function headSha(run, manifest) {
  const result = await run('gh', [
    'api', `repos/${manifest.repo}/branches/${manifest.default_branch}`,
    '--jq', '.commit.sha',
  ]);
  return (result.stdout ?? '').trim();
}

async function triggerDeployWorkflow(run, manifest) {
  const args = ['workflow', 'run', manifest.deploy.workflow, '-R', manifest.repo];
  for (const [key, value] of Object.entries(manifest.deploy.confirm_inputs ?? {})) {
    args.push('-f', `${key}=${value}`);
  }
  await run('gh', args);
}

/**
 * Execute the decided runbook for one incident. Only called when
 * decision.action === 'auto_remediate'.
 *
 * Returns { executed, deployed, pr_url }.
 */
export async function execute({ incident, decision, manifest, store, run, now = new Date() }) {
  incrementAttempts(store, incident.incident_uid);
  setIncidentStatus(store, incident.incident_uid, 'remediating', now);

  if (decision.runbook.kind === 'workflow') {
    const sha = await headSha(run, manifest);
    await triggerDeployWorkflow(run, manifest);
    recordDeployment(store, {
      platform: incident.platform,
      incident_uid: incident.incident_uid,
      kind: 'deploy',
      workflow: manifest.deploy.workflow,
      pre_sha: sha,
      head_sha: sha,
    }, now);
    return { executed: true, deployed: true, pr_url: null };
  }

  if (decision.runbook.kind === 'revert_pr') {
    return revertLastDeployment({ incident, decision, manifest, store, run, autoMerge: true, now });
  }

  throw new Error(`Unknown runbook kind: ${decision.runbook.kind}`);
}

/**
 * Open a PR that reverts the platform's most recent recorded deployment
 * (or, with no recorded deployment, its latest commit); optionally merge
 * once CI is green and trigger the deploy workflow.
 */
export async function revertLastDeployment({ incident, decision, manifest, store, run, autoMerge, reason, now = new Date() }) {
  const previous = lastDeployment(store, incident.platform);
  const branch = `guardian/incident-${incident.incident_uid}`;
  const workdir = join(mkdtempSync(join(tmpdir(), 'guardian-remediate-')), 'repo');

  await run('gh', ['repo', 'clone', manifest.repo, workdir, '--', '--depth', '50']);
  await run('git', ['-C', workdir, 'checkout', '-b', branch]);

  if (previous?.pre_sha && previous?.head_sha && previous.pre_sha !== previous.head_sha) {
    await run('git', ['-C', workdir, 'revert', '--no-edit', `${previous.pre_sha}..${previous.head_sha}`]);
  } else {
    await run('git', ['-C', workdir, 'revert', '--no-edit', 'HEAD']);
  }

  await run('git', ['-C', workdir, 'push', 'origin', branch]);

  const bodyFile = join(workdir, '..', 'PR_BODY.md');
  writeFileSync(bodyFile, issueBody({
    incident,
    decision,
    recall: null,
    extraLines: reason ? ['', '### Trigger', '', reason] : [],
  }));

  const prResult = await run('gh', [
    'pr', 'create',
    '-R', manifest.repo,
    '--base', manifest.default_branch,
    '--head', branch,
    '--title', `[guardian] Revert last deployment (${incident.signature})`,
    '--body-file', bodyFile,
  ]);
  const prUrl = (prResult.stdout ?? '').trim() || null;

  if (!autoMerge) {
    return { executed: true, deployed: false, pr_url: prUrl };
  }

  // Merge only with green CI: --watch waits for checks and fails on a red.
  await run('gh', ['pr', 'checks', branch, '-R', manifest.repo, '--watch', '--fail-fast']);
  const preMergeSha = await headSha(run, manifest);
  await run('gh', ['pr', 'merge', branch, '-R', manifest.repo, '--squash', '--delete-branch']);
  const postMergeSha = await headSha(run, manifest);
  await triggerDeployWorkflow(run, manifest);

  recordDeployment(store, {
    platform: incident.platform,
    incident_uid: incident.incident_uid,
    kind: 'rollback',
    workflow: manifest.deploy.workflow,
    pre_sha: preMergeSha,
    head_sha: postMergeSha,
  }, now);

  return { executed: true, deployed: true, pr_url: prUrl };
}

/**
 * Undo a remediation whose post-deploy verification failed. A plain
 * redeploy shipped no code change, so there is nothing to revert -- the
 * caller escalates instead. A merged revert/patch PR gets reverted in turn
 * and redeployed.
 */
export async function rollback({ incident, decision, manifest, store, run, now = new Date() }) {
  const deployment = lastDeployment(store, incident.platform);

  if (!deployment || deployment.kind === 'deploy' && deployment.pre_sha === deployment.head_sha) {
    return { rolledBack: false, reason: 'last remediation shipped no code change; nothing to revert' };
  }

  const result = await revertLastDeployment({
    incident,
    decision,
    manifest,
    store,
    run,
    autoMerge: true,
    reason: 'Post-deploy verification failed; reverting the guardian\'s own change.',
    now,
  });
  return { rolledBack: result.deployed, pr_url: result.pr_url };
}
