// services/infodot-knowledge/src/run.js
//
//   pull -> read outcomes -> score -> (write decisions) -> grade
//
// Both READS happen before any write, so a failed read can never leave a
// half-finished run: either Brain knows what moderators already declined, or
// it writes nothing. (The spec lists outcomes after the writes; they are read
// first because suppressing re-recommendations of declined items needs them.)
// Brain stores nothing between runs: Dot.Memory is the store, and event_ids
// make every write idempotent.
import { buildDecisionRecord, parseEventId } from './decision.js';
import { gradeOutcomes, DEFAULT_MIN_SAMPLE } from './grade.js';
import { EPOCH, pullCandidates } from './infodot.js';
import { readOutcomes, writeDecision } from './memory.js';
import { RULE_VERSION, VERDICTS, scoreCandidate } from './rules.js';

/**
 * @param {object} o
 * @param {{infodotUrl: string, secret: string, memoryUrl: string, memoryToken: string}} o.cfg
 * @param {boolean} [o.apply]  false (default) = dry run: reads only, writes nothing.
 * @returns {Promise<{ok: true, summary: object} | {ok: false, stage: string, reason: string}>}
 */
export async function runKnowledge({
  cfg,
  apply = false,
  since = EPOCH,
  limit,
  maxPages,
  ruleConfig = {},
  minSample = DEFAULT_MIN_SAMPLE,
  now = () => new Date(),
  fetchImpl = fetch,
  sleep,
  delaysMs,
  timeoutMs,
}) {
  const transport = { fetchImpl, sleep, delaysMs, timeoutMs };

  const pulled = await pullCandidates({
    baseUrl: cfg.infodotUrl, secret: cfg.secret, since, limit, maxPages, now, ...transport,
  });
  if (!pulled.ok) return pulled;

  const outcomes = await readOutcomes(cfg, { since: EPOCH, now, ...transport });
  if (!outcomes.ok) return outcomes;

  // Contributions whose LATEST moderator outcome is "declined", keyed to what
  // that declined decision was based on (the `material` segment of its
  // event_id). A decline that was later overturned by an adoption is not here.
  const lastOutcome = new Map();
  for (const row of outcomes.items) {
    const prev = lastOutcome.get(row.contribution_ref);
    if (!prev || String(row.decided_at ?? '') >= String(prev.decided_at ?? '')) {
      lastOutcome.set(row.contribution_ref, row);
    }
  }
  const declined = new Map();
  for (const [ref, row] of lastOutcome) {
    if (row.outcome === 'declined') {
      declined.set(ref, parseEventId(row.decision_event_id)?.material ?? row.decision_event_id);
    }
  }

  const at = now();
  const verdicts = Object.fromEntries(VERDICTS.map((v) => [v, 0]));
  const records = [];
  let suppressed = 0;

  for (const item of pulled.items) {
    const result = scoreCandidate(item, at, ruleConfig);
    verdicts[result.verdict] += 1;
    const record = buildDecisionRecord(item, result, at, ruleConfig);

    // A declined item is not offered again unless something about the
    // contribution itself changed (edits, new corroboration, topics...). A
    // changed helpful or reuse count is not such a change.
    if (result.verdict === 'recommend_for_library' && declined.has(item.contribution_ref)) {
      const material = parseEventId(record.event_id).material;
      if (declined.get(item.contribution_ref) === material) {
        suppressed += 1;
        continue;
      }
    }
    records.push(record);
  }

  let written = 0;
  let writeFailed = 0;
  if (apply) {
    for (const record of records) {
      const res = await writeDecision(cfg, record, transport);
      if (res.ok) written += 1;
      else writeFailed += 1;
    }
  }

  const grading = gradeOutcomes(
    records.map((r) => ({ event_id: r.event_id, rule_version: r.detail.rule_version })),
    outcomes.items,
    { minSample },
  );

  return {
    ok: true,
    summary: {
      mode: apply ? 'apply' : 'dry-run',
      rule_version: RULE_VERSION,
      pulled: pulled.items.length,
      pages: pulled.pages,
      truncated: pulled.truncated,
      malformed_items: pulled.malformed,
      verdicts,
      suppressed_declined: suppressed,
      decisions_planned: records.length,
      written,
      write_failed: writeFailed,
      outcomes_read: outcomes.items.length,
      outcomes_ignored: outcomes.ignored,
      grading,
    },
  };
}

/** Counts-only text: no refs, no topics, no urls, nothing a person could be found in. */
export function formatSummary(s) {
  const lines = [
    `mode: ${s.mode}`,
    `rule_version: ${s.rule_version}`,
    `pulled: ${s.pulled} (pages ${s.pages}${s.truncated ? ', TRUNCATED' : ''}, malformed ${s.malformed_items})`,
    `verdicts: recommend_for_library ${s.verdicts.recommend_for_library}, watch ${s.verdicts.watch}, do_not_recommend ${s.verdicts.do_not_recommend}`,
    `suppressed (declined, unchanged): ${s.suppressed_declined}`,
    `decisions planned: ${s.decisions_planned}`,
    `written: ${s.written}, failed: ${s.write_failed}`,
    `outcomes read: ${s.outcomes_read} (ignored ${s.outcomes_ignored})`,
  ];
  const versions = Object.entries(s.grading.by_rule_version);
  if (versions.length === 0) lines.push('grading: no graded recommendations yet');
  for (const [version, g] of versions) {
    lines.push(g.status === 'ok'
      ? `grading ${version}: hit-rate ${(g.hit_rate * 100).toFixed(1)}% (adopted ${g.adopted}, declined ${g.declined}, n=${g.sample})`
      : `grading ${version}: insufficient data (n=${g.sample}, need ${g.min_sample})`);
  }
  if (s.grading.ungradable) lines.push(`grading: ${s.grading.ungradable} outcome(s) with an unreadable decision id`);
  return lines.join('\n');
}
