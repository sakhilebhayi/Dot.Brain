// services/infodot-knowledge/src/memory.js
//
// Contract 2 (write a decision, bearer token) and contract 3 (read outcomes,
// HMAC-signed). The two use different credentials on purpose: the write is the
// existing Sanctum API; the read is the knowledge-recommendations endpoint
// Memory exposes under the same secret as InfoDot's pull.
import { signedHeaders } from './hmac.js';
import { requestJson } from './http.js';

/** POST one decision. Never throws. */
export async function writeDecision(cfg, record, opts = {}) {
  const result = await requestJson({
    url: `${cfg.memoryUrl}/api/intelligence/decisions`,
    method: 'POST',
    body: JSON.stringify(record),
    headers: () => ({ Authorization: `Bearer ${cfg.memoryToken}` }),
    secrets: [cfg.memoryToken, cfg.secret],
    ...opts,
  });
  return result.ok ? { ok: true } : { ok: false, reason: `Dot.Memory decisions: ${result.reason}` };
}

/**
 * GET the moderators' outcomes for past recommendations.
 * @returns {Promise<{ok: true, items: {contribution_ref: string, decision_event_id: string, outcome: 'adopted'|'declined', decided_at: string|null}[], ignored: number} |
 *   {ok: false, stage: 'outcomes', reason: string}>}
 */
export async function readOutcomes(cfg, { since, now = () => new Date(), ...opts }) {
  const query = new URLSearchParams({ since });
  const result = await requestJson({
    url: `${cfg.memoryUrl}/api/knowledge-recommendations/outcomes?${query}`,
    headers: () => signedHeaders(cfg.secret, { now: now() }),
    secrets: [cfg.memoryToken, cfg.secret],
    ...opts,
  });

  if (!result.ok) {
    return { ok: false, stage: 'outcomes', reason: `Dot.Memory outcomes: ${result.reason}` };
  }
  if (!result.json || !Array.isArray(result.json.items)) {
    return { ok: false, stage: 'outcomes', reason: 'Dot.Memory outcomes: response did not match the contract' };
  }

  const items = [];
  let ignored = 0;
  for (const row of result.json.items) {
    if (row && typeof row.contribution_ref === 'string' && typeof row.decision_event_id === 'string'
        && (row.outcome === 'adopted' || row.outcome === 'declined')) {
      items.push({
        contribution_ref: row.contribution_ref,
        decision_event_id: row.decision_event_id,
        outcome: row.outcome,
        decided_at: typeof row.decided_at === 'string' ? row.decided_at : null,
      });
    } else {
      ignored += 1;
    }
  }
  return { ok: true, items, ignored };
}
