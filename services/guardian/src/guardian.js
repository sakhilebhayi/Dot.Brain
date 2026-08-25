import { fetchHealth } from './health.js';
import { reconcile } from './detect.js';
import { evaluate } from './decide.js';
import * as memory from './memory-client.js';
import { execute, rollback } from './remediate.js';
import { postDeploy } from './verify.js';
import * as escalation from './escalate.js';
import {
  breakerFor,
  deploymentsSince,
  hasEscalation,
  recordVerification,
  setIncidentStatus,
  touchIncident,
} from './store.js';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/**
 * One full guardian cycle for every registered platform:
 *
 *   flush memory outbox -> fetch health -> reconcile incidents ->
 *   for each active incident: recall history -> decide -> act
 *   (observe / recommend / auto-remediate+verify+rollback / escalate) ->
 *   record everything to Dot.Memory.
 *
 * All I/O is injected (fetchImpl, run, sleepImpl, env) so the entire
 * lifecycle is testable against mock servers and a fake gh/git exec.
 */
export async function runPoll({
  store,
  manifests,
  fetchImpl = fetch,
  run,
  env = process.env,
  sleepImpl,
  now = () => new Date(),
  log = () => {},
}) {
  const memoryCfg = memory.memoryConfig(env);
  const summary = [];

  for (const manifest of manifests) {
    await memory.flush(memoryCfg, store, fetchImpl);

    const health = await fetchHealth(manifest, fetchImpl, env);
    const { opened, ongoing, resolved } = reconcile(store, manifest, health, now());
    const actions = [];

    for (const incident of resolved) {
      await memory.record(memoryCfg, store, memory.toMemoryRecord(incident, manifest, {
        validation_result: 'healthy',
      }), fetchImpl);
      actions.push({ incident_uid: incident.incident_uid, action: 'resolved' });
      log(`[${manifest.platform}] resolved ${incident.signature} (${incident.incident_uid})`);
    }

    for (const incident of [...opened, ...ongoing]) {
      const recall = await memory.recall(memoryCfg, {
        platform: incident.platform,
        signature: incident.signature,
      }, fetchImpl);

      const sinceIso = new Date(now().getTime() - SIX_HOURS_MS).toISOString();
      const decision = evaluate({
        incident,
        manifest,
        recall,
        breakerOpen: breakerFor(store, manifest.platform).state === 'open',
        deploysLast6h: deploymentsSince(store, manifest.platform, sinceIso).length,
      });

      log(`[${manifest.platform}] ${incident.signature} -> ${decision.action} (confidence ${decision.confidence}, risk ${decision.risk})`);

      // Upsert on EVERY poll, not only at open: Dot.Memory upserts by
      // incident_uid, and an incident opened while memory was disabled or
      // unreachable would otherwise never be archived until it closed.
      await memory.record(memoryCfg, store, memory.toMemoryRecord(incident, manifest, {
        record: { decision },
      }), fetchImpl);

      // Per-incident error boundary: one failed action (gh unavailable, a
      // push rejected, a network blip) must not abort the rest of the poll
      // -- the remaining incidents still deserve detection and action.
      let acted;
      try {
        acted = await act({
          incident, decision, recall, manifest, store, memoryCfg, fetchImpl, run, env, sleepImpl, now, log,
        });
      } catch (error) {
        acted = { error: error.message };
        log(`[${manifest.platform}] action failed for ${incident.signature}: ${error.message}`);
      }
      actions.push({ incident_uid: incident.incident_uid, action: decision.action, ...acted });
    }

    summary.push({
      platform: manifest.platform,
      reachable: health.reachable,
      status: health.reachable ? health.status : 'unreachable',
      opened: opened.length,
      ongoing: ongoing.length,
      resolved: resolved.length,
      actions,
    });
  }

  return summary;
}

async function act({ incident, decision, recall, manifest, store, memoryCfg, fetchImpl, run, env, sleepImpl, now, log }) {
  if (decision.action === 'observe') {
    return {};
  }

  if (decision.action === 'recommend') {
    if (hasEscalation(store, incident.incident_uid)) {
      return { issue: 'already-open' };
    }
    const issueUrl = await escalation.recommend({ store, manifest, incident, decision, recall, run, now: now() });
    return { issue: issueUrl };
  }

  if (decision.action === 'escalate') {
    if (hasEscalation(store, incident.incident_uid)) {
      return { issue: 'already-open' };
    }
    const issueUrl = await escalation.raise({
      store, manifest, incident, decision, recall, run,
      reason: decision.reasons.join('; '),
      now: now(),
    });
    const escalated = setIncidentStatus(store, incident.incident_uid, 'escalated', now());
    await memory.record(memoryCfg, store, memory.toMemoryRecord(escalated, manifest, {
      record: { decision, escalation_issue: issueUrl },
    }), fetchImpl);
    return { issue: issueUrl };
  }

  // auto_remediate
  const result = await execute({ incident, decision, manifest, store, run, now: now() });

  if (!result.deployed) {
    return { pr_url: result.pr_url, deployed: false };
  }

  const verification = await postDeploy({
    manifest,
    checkKey: incident.check_key,
    fetchImpl,
    env,
    sleepImpl,
  });
  recordVerification(store, manifest.platform, verification.ok, now());

  if (verification.ok) {
    const closed = setIncidentStatus(store, incident.incident_uid, 'resolved', now());
    await memory.record(memoryCfg, store, memory.toMemoryRecord(closed, manifest, {
      deploy_result: 'success',
      validation_result: 'healthy',
      record: { decision, runbook: decision.runbook.key, pr_url: result.pr_url },
    }), fetchImpl);
    log(`[${manifest.platform}] ${incident.signature} remediated and verified`);
    return { deployed: true, verified: true, pr_url: result.pr_url };
  }

  // Verification failed: undo our own change where one exists, keep the
  // incident OPEN so the attempt counter (already incremented) still
  // gates the next try, and record the failure to Dot.Memory.
  const undone = await rollback({ incident, decision, manifest, store, run, now: now() });
  const reopened = setIncidentStatus(store, incident.incident_uid, 'open', now());
  touchIncident(store, incident.incident_uid, {
    detail: { ...safeDetail(reopened), last_verification: verification.observations },
  }, now());

  await memory.record(memoryCfg, store, memory.toMemoryRecord(reopened, manifest, {
    deploy_result: 'success',
    validation_result: 'failed',
    rollback_occurred: undone.rolledBack,
    record: { decision, runbook: decision.runbook.key, pr_url: result.pr_url, rollback: undone },
  }), fetchImpl);

  log(`[${manifest.platform}] ${incident.signature} verification FAILED; rolled back: ${undone.rolledBack}`);
  return { deployed: true, verified: false, rolled_back: undone.rolledBack, pr_url: result.pr_url };
}

function safeDetail(incident) {
  try {
    return typeof incident.detail === 'string' ? JSON.parse(incident.detail) : {};
  } catch {
    return {};
  }
}
