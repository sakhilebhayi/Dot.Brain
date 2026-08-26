import { randomUUID } from 'node:crypto';
import { fetchContext, recordAction, recordDecision } from './memory-client.js';
import { reason } from './reason.js';

/**
 * One turn of the ecosystem intelligence loop (ADR-0015):
 *
 *   ask Memory what is known -> reason about it -> record the decision ->
 *   hand an approved action to its executor -> record what the executor did
 *
 * Measuring the result is a separate step on purpose: the outcome of an
 * intervention is rarely visible in the same breath as the action, and
 * pretending otherwise is how systems learn things that are not true.
 */
export async function runLoop({
  subject,
  proposal,
  policy,
  platform = 'dot-brain',
  source = 'intelligence-loop',
  cfg,
  execute,
  fetchImpl = fetch,
  now = () => new Date(),
  loopId = `loop-${randomUUID()}`,
}) {
  const at = now().toISOString();

  const context = await fetchContext(cfg, {
    subjectType: subject.type,
    subjectId: subject.id,
    signature: proposal?.signature,
    platform: subject.platform,
  }, fetchImpl);

  // Memory being unreachable must never read as "nothing ever happened":
  // that would let a machine act confidently on an absence of evidence it
  // never actually checked.
  const decision = context.available
    ? reason({ context, proposal, policy })
    : {
      action: 'observe',
      recommendation: 'Hold: the record of what we know could not be read.',
      confidence: 0,
      risk: proposal?.risk ?? 0.5,
      autonomy_level: 'observe',
      requires_approval: true,
      rationale: [`Dot.Memory was unreachable (${context.reason}), so nothing can be decided on evidence.`],
    };

  const envelope = {
    loop_id: loopId,
    platform,
    source,
    subject_type: subject.type,
    subject_id: subject.id,
    subject_label: subject.label,
    signature: proposal?.signature,
    occurred_at: at,
  };

  await recordDecision(cfg, {
    ...envelope,
    event_id: `${loopId}-decision`,
    confidence: decision.confidence,
    risk: decision.risk,
    autonomy_level: decision.autonomy_level,
    requires_approval: decision.requires_approval,
    detail: { recommendation: decision.recommendation, rationale: decision.rationale },
  }, fetchImpl);

  if (decision.action !== 'execute' || typeof execute !== 'function') {
    return { loop_id: loopId, context, decision, executed: false };
  }

  const result = await execute({ decision, subject, proposal, loopId });

  await recordAction(cfg, {
    ...envelope,
    event_id: `${loopId}-action`,
    platform: proposal.executor_platform ?? platform,
    action_kind: proposal.action_kind,
    executor_platform: proposal.executor_platform ?? platform,
    mechanic_ref: proposal.mechanic_ref,
    approval_status: decision.requires_approval ? 'approved' : 'not_required',
    execution_status: result?.status ?? 'pending',
    detail: result?.detail ?? null,
  }, fetchImpl);

  return { loop_id: loopId, context, decision, executed: true, result };
}
