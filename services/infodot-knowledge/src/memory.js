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

export const OUTCOMES_PAGE = 500;
const OUTCOMES_MAX_PAGES = 100;

/**
 * GET the moderators' outcomes for past recommendations.
 *
 * Memory returns EVERY outcome row (history), oldest first, `since` inclusive.
 * A decision can therefore appear more than once (declined, later adopted):
 * only the latest row per decision_event_id is kept, so a stale "declined"
 * can never suppress, or mis-grade, a decision that was later adopted. Pages
 * are followed by moving `since` to the last row's decided_at.
 *
 * @returns {Promise<{ok: true, items: {contribution_ref: string, decision_event_id: string, outcome: 'adopted'|'declined', decided_at: string|null}[], ignored: number} |
 *   {ok: false, stage: 'outcomes', reason: string}>}
 */
export async function readOutcomes(cfg, { since, limit = OUTCOMES_PAGE, now = () => new Date(), ...opts }) {
  const latest = new Map();
  let ignored = 0;
  let cursor = since;

  for (let page = 0; page < OUTCOMES_MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ since: cursor, limit: String(limit) });
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

    const rows = result.json.items;
    let lastAt = null;
    for (const row of rows) {
      if (!(row && typeof row.contribution_ref === 'string' && typeof row.decision_event_id === 'string'
          && (row.outcome === 'adopted' || row.outcome === 'declined'))) {
        ignored += 1;
        continue;
      }
      const entry = {
        contribution_ref: row.contribution_ref,
        decision_event_id: row.decision_event_id,
        outcome: row.outcome,
        decided_at: typeof row.decided_at === 'string' ? row.decided_at : null,
      };
      const prev = latest.get(entry.decision_event_id);
      // Oldest first, so a later row wins ties; an older timestamp never replaces a newer one.
      if (!prev || String(entry.decided_at ?? '') >= String(prev.decided_at ?? '')) {
        latest.set(entry.decision_event_id, entry);
      }
      if (entry.decided_at) lastAt = entry.decided_at;
    }

    // A short page is the last page. A full page continues from its last row
    // (inclusive `since` repeats that row, which the map absorbs); no progress ends it.
    if (rows.length < limit || lastAt === null || lastAt === cursor) break;
    cursor = lastAt;
  }

  return { ok: true, items: [...latest.values()], ignored };
}
