import { randomUUID } from 'node:crypto';
import { recordAction, recordOutcome } from './memory-client.js';

const SCOPE = 'admin';

/**
 * Push delivery of a gate-cleared, revenue-intelligence-generated
 * Insight, routed entirely through Dot.Notify (design spec §2), always
 * scoped to admin recipients -- Notify's own per-recipient consent/role
 * resolution decides who that reaches, the same mechanism every other
 * platform's alerts already use.
 *
 * @param {object} args
 * @param {string} args.insightId
 * @param {string} args.targetPlatform
 * @param {object} args.cfg
 * @param {{deliver: (a: {insightId: string, targetPlatform: string, scope: string}) => Promise<{status: string, detail?: object}>}} args.notifyClient
 * @param {typeof fetch} [args.fetchImpl]
 * @param {() => Date} [args.now]
 * @param {string} [args.loopId]
 */
export async function deliverInsight({
  insightId,
  targetPlatform,
  cfg,
  notifyClient,
  fetchImpl = fetch,
  now = () => new Date(),
  loopId = `loop-${randomUUID()}`,
}) {
  const result = await notifyClient.deliver({ insightId, targetPlatform, scope: SCOPE });

  const actionResult = await recordAction(cfg, {
    loop_id: loopId,
    stage: 'action',
    platform: 'dot-brain',
    subject: { type: 'insight', id: insightId },
    source: 'revenue-intelligence',
    action: {
      kind: 'insight.deliver',
      executor_platform: 'dot-notify',
      detail: { insight_id: insightId, target_platform: targetPlatform, scope: SCOPE },
      execution_status: result.status,
    },
    occurred_at: now().toISOString(),
  }, fetchImpl);

  return {
    loop_id: loopId,
    delivered: result.status === 'succeeded',
    execution_status: result.status,
    recorded: actionResult.ok,
  };
}

/**
 * Closes the loop's outcome stage from Dot.Notify's existing
 * messaging.delivery.acted/ignored event -- no new outcome-tracking
 * mechanism, same as services/insight-delivery.
 */
export async function recordDeliveryOutcome(cfg, { loopId, insightId, verdict, observedAt }, fetchImpl = fetch) {
  return recordOutcome(cfg, {
    loop_id: loopId,
    stage: 'outcome',
    platform: 'dot-brain',
    subject: { type: 'insight', id: insightId },
    source: 'revenue-intelligence',
    occurred_at: observedAt,
    outcome: { verdict, observed_at: observedAt },
  }, fetchImpl);
}
