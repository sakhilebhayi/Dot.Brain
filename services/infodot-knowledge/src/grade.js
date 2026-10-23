// services/infodot-knowledge/src/grade.js
import { parseEventId } from './decision.js';

export const DEFAULT_MIN_SAMPLE = 10;

/**
 * How often moderators adopt what a given rule version recommended.
 *
 * hit_rate = adopted / (adopted + declined), reported ONLY once the sample
 * reaches `minSample`; below it the answer is "insufficient data", never a
 * number (a rate from four decisions is an anecdote -- same stance as
 * reason.js's min_attempts_for_confidence). One outcome per decision: if a
 * decision has several rows, the latest `decided_at` wins.
 *
 * @param {{event_id: string, rule_version?: string}[]} decisions  Decisions known to this run (optional help).
 * @param {{decision_event_id: string, outcome: string, decided_at?: string|null}[]} outcomes
 * @returns {{by_rule_version: Record<string, {adopted: number, declined: number, sample: number,
 *   min_sample: number, status: 'ok'|'insufficient data', hit_rate: number|null}>, ungradable: number}}
 */
export function gradeOutcomes(decisions, outcomes, { minSample = DEFAULT_MIN_SAMPLE } = {}) {
  const known = new Map((decisions ?? []).map((d) => [d.event_id, d.rule_version]));

  const latest = new Map();
  for (const row of outcomes ?? []) {
    if (row?.outcome !== 'adopted' && row?.outcome !== 'declined') continue;
    const prev = latest.get(row.decision_event_id);
    if (!prev || String(row.decided_at ?? '') >= String(prev.decided_at ?? '')) {
      latest.set(row.decision_event_id, row);
    }
  }

  const tally = {};
  let ungradable = 0;
  for (const [eventIdValue, row] of latest) {
    const version = known.get(eventIdValue) ?? parseEventId(eventIdValue)?.rule_version;
    if (!version) {
      ungradable += 1;
      continue;
    }
    tally[version] ??= { adopted: 0, declined: 0 };
    tally[version][row.outcome] += 1;
  }

  const by_rule_version = {};
  for (const [version, t] of Object.entries(tally).sort(([a], [b]) => a.localeCompare(b))) {
    const sample = t.adopted + t.declined;
    const enough = sample >= minSample;
    by_rule_version[version] = {
      adopted: t.adopted,
      declined: t.declined,
      sample,
      min_sample: minSample,
      status: enough ? 'ok' : 'insufficient data',
      hit_rate: enough ? Number((t.adopted / sample).toFixed(3)) : null,
    };
  }

  return { by_rule_version, ungradable };
}
