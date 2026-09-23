import { detectOpportunities } from './opportunities.js';
import { runEthicsGate, runSecurityGate } from './gates.js';
import { recordInsight } from './memory-client.js';
import { deliverInsight } from './deliver.js';

/**
 * Detect -> gate -> record -> deliver for one Revenue Reader poll
 * result (design spec §3). Every candidate is accounted for in exactly
 * one of the two returned arrays -- nothing is silently dropped.
 *
 * @param {object} args
 * @param {object} args.pollResult
 * @param {object} args.cfg
 * @param {object} args.notifyClient
 * @param {Array<'public'|'restricted'>} [args.targetPlatformClearance]
 * @param {typeof fetch} [args.fetchImpl]
 */
export async function runPipeline({ pollResult, cfg, notifyClient, targetPlatformClearance = ['public'], fetchImpl = fetch }) {
  const candidates = detectOpportunities(pollResult);
  const delivered = [];
  const rejected = [];

  for (const insight of candidates) {
    const ethics = runEthicsGate(insight);
    if (!ethics.passed) {
      rejected.push({ insight, gate: 'ethics', reason: ethics.reason });
      continue;
    }

    const security = runSecurityGate(insight, targetPlatformClearance);
    if (!security.passed) {
      rejected.push({ insight, gate: 'security', reason: security.reason });
      continue;
    }

    const insightId = insight.evidence[0].reference;
    const recordResult = await recordInsight(cfg, insight, fetchImpl);
    const deliverResult = await deliverInsight({
      insightId,
      targetPlatform: pollResult.platform,
      cfg,
      notifyClient,
      fetchImpl,
    });

    delivered.push({ insight, recorded: recordResult.ok, delivered: deliverResult.delivered });
  }

  return { delivered, rejected };
}
