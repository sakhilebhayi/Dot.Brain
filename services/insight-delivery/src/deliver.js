import { randomUUID } from 'node:crypto';
import { recordAction, recordOutcome } from './memory-client.js';

/**
 * Push delivery of a gate-cleared Insight, routed entirely through
 * Dot.Notify (design spec §4). Brain records the ADR-0015 intelligence-loop
 * action envelope and hands the actual send to notifyClient -- it never
 * chooses a channel, touches consent, or retries delivery itself.
 *
 * @param {object} args
 * @param {string} args.insightId
 * @param {string} args.targetPlatform
 * @param {string} [args.scope]
 * @param {object} args.cfg
 * @param {{deliver: (a: {insightId: string, targetPlatform: string, scope?: string}) => Promise<{status: string, detail?: object}>}} args.notifyClient
 * @param {typeof fetch} [args.fetchImpl]
 * @param {() => Date} [args.now]
 * @param {string} [args.loopId]
 */
export async function deliverInsight({
  insightId,
  targetPlatform,
  scope,
  cfg,
  notifyClient,
  fetchImpl = fetch,
  now = () => new Date(),
  loopId = `loop-${randomUUID()}`,
}) {
  const result = await notifyClient.deliver({ insightId, targetPlatform, scope });

  const { ok: recorded } = await recordAction(cfg, {
    loop_id: loopId,
    stage: 'action',
    platform: 'dot-brain',
    subject: { type: 'insight', id: insightId },
    source: 'insight-classification',
    action: {
      kind: 'insight.deliver',
      executor_platform: 'dot-notify',
      detail: { insight_id: insightId, target_platform: targetPlatform, scope },
      execution_status: result.status,
    },
    occurred_at: now().toISOString(),
  }, fetchImpl);

  return { loop_id: loopId, delivered: result.status === 'succeeded', execution_status: result.status, recorded };
}

/**
 * Closes the loop's outcome stage from Dot.Notify's
 * messaging.delivery.acted/ignored event (design spec §4) -- no new
 * outcome-tracking mechanism, this consumes an event source Brain
 * already understands.
 */
export async function recordDeliveryOutcome(cfg, { loopId, insightId, verdict, observedAt }, fetchImpl = fetch) {
  return recordOutcome(cfg, {
    loop_id: loopId,
    stage: 'outcome',
    platform: 'dot-brain',
    subject: { type: 'insight', id: insightId },
    source: 'notify-delivery-event',
    occurred_at: observedAt,
    outcome: { verdict, observed_at: observedAt },
  }, fetchImpl);
}
