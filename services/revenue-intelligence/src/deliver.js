import { randomUUID } from 'node:crypto';
import { recordAction, recordOutcome } from './memory-client.js';

const AUDIENCE = 'admin';

/**
 * Push delivery of a gate-cleared, revenue-intelligence-generated
 * Insight, routed entirely through Dot.Notify (design spec §2), always
 * addressed to the admin audience -- Notify's own per-recipient
 * consent/role resolution decides who that reaches, the same mechanism
 * every other platform's alerts already use. `audience` is a
 * delivery-time parameter only -- deliberately distinct from the
 * Insight's own `scope` field (insight.schema.json: "where the insight
 * applies, site/tenant/global"), which opportunities.js already sets to
 * the enrolling platform. The two are different concepts that happen to
 * share a tempting name; conflating them would misuse the schema.
 *
 * @param {object} args
 * @param {string} args.insightId
 * @param {string} args.targetPlatform
 * @param {object} args.cfg
 * @param {{deliver: (a: {insightId: string, targetPlatform: string, audience: string}) => Promise<{status: string, detail?: object}>}} args.notifyClient
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
  // A rejected notifyClient.deliver() (as opposed to a resolved
  // {status: 'failed'}) used to escape uncaught -- aborting runPipeline's
  // loop over the REST of that poll result's candidates, contrary to the
  // documented one-bad-candidate-never-blocks-the-others behavior.
  // Normalizing it here keeps deliverInsight itself total, and still
  // records the action so the failure is auditable.
  let result;
  try {
    result = await notifyClient.deliver({ insightId, targetPlatform, audience: AUDIENCE });
  } catch (error) {
    result = { status: 'failed', detail: { error: error.message } };
  }

  const actionResult = await recordAction(cfg, {
    loop_id: loopId,
    stage: 'action',
    platform: 'dot-brain',
    subject: { type: 'insight', id: insightId },
    source: 'revenue-intelligence',
    action: {
      kind: 'insight.deliver',
      executor_platform: 'dot-notify',
      detail: { insight_id: insightId, target_platform: targetPlatform, audience: AUDIENCE },
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
    // Matches services/insight-delivery's deliver.js exactly: `source`
    // here names where the OUTCOME data came from (Notify's own event),
    // not who is recording it -- 'revenue-intelligence' would misattribute
    // provenance and make a Notify-sourced outcome indistinguishable from
    // a Brain-originated record to a loop consumer.
    source: 'notify-delivery-event',
    occurred_at: observedAt,
    outcome: { verdict, observed_at: observedAt },
  }, fetchImpl);
}
