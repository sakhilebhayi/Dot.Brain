// services/infodot-knowledge/src/rules.js
//
// The decision step: is this approved InfoDot contribution worth RECOMMENDING
// to a moderator for the Verified library?
//
// A PURE function, deliberately (same stance as services/intelligence/src/
// reason.js): every branch is a claim about when a machine may put something
// in front of a human curator, so it lives in something a person can read and
// a test can pin, not in I/O code. It decides nothing about the library
// itself -- only a moderator does -- and it never awards anything.
//
// Governance (brain.community.md sections 1, 3, 4), enforced here:
//   * Reputation never sets trust. helpful_count / reuse_count are NOT trust
//     inputs: they may nudge CONFIDENCE by a small bounded amount, only for an
//     already-corroborated contribution, and can never change the verdict.
//   * "Quality" means corroboration by someone other than the author, never
//     volume or points. author_uuid is not read at all.
//   * No person-level score exists anywhere in this file.
//   * Out of scope: duplicate / contradiction detection between contributions.
//     This function judges one contribution at a time, so two items that say
//     the same thing (or opposite things) can both be recommended. A moderator
//     sees that; this code does not claim to.

export const RULE_VERSION = 'infodot-knowledge/1.0.0';

export const VERDICTS = ['recommend_for_library', 'watch', 'do_not_recommend'];
export const KINDS = ['answer', 'solution'];

const DAY_MS = 86_400_000;

// The most any popularity-style signal may ever add to confidence, whatever a
// caller configures. Small on purpose: it is a tie-breaker, not evidence.
export const MAX_POPULARITY_BONUS = 0.05;

export const DEFAULT_CONFIG = Object.freeze({
  // (d) A corroboration must be at least this old, and the contribution
  // unedited for at least this long, before it is recommended. Boundary is
  // inclusive: exactly N days counts as settled.
  settle_days: 14,
  // (f) A contribution whose latest activity (created or edited) is at least
  // this many calendar months old, and that has never been reused, is only
  // watched. Boundary is inclusive.
  stale_months: 18,
  // Confidence is EARNED from the table below, like reason.js: it starts from
  // a modest prior and rises only on independent corroboration, then every
  // gate can only LOWER it (ceilings).
  confidence: Object.freeze({
    base: 0.4,
    accepted_by_independent: 0.15,
    verified_by_independent: 0.2,
    both_corroborations: 0.05,
    long_settled: 0.03, // settled for at least twice settle_days
    helpful_per_vote: 0.005,
    helpful_max: 0.04,
    reuse_per_use: 0.01,
    reuse_max: 0.04,
    ceiling: 0.9, // nothing a rule engine says is ever certain
    watch_ceiling: 0.6, // not yet settled / stale: never above this
    blocked_ceiling: 0.2, // excluded: never above this
  }),
});

/** Merge and validate a caller's overrides; throws on nonsense rather than guessing. */
export function resolveConfig(overrides = {}) {
  const c = { ...DEFAULT_CONFIG.confidence, ...(overrides.confidence ?? {}) };
  const cfg = {
    settle_days: overrides.settle_days ?? DEFAULT_CONFIG.settle_days,
    stale_months: overrides.stale_months ?? DEFAULT_CONFIG.stale_months,
    confidence: c,
  };

  if (!Number.isFinite(cfg.settle_days) || cfg.settle_days < 0) {
    throw new Error('settle_days must be a number >= 0');
  }
  if (!Number.isInteger(cfg.stale_months) || cfg.stale_months < 1) {
    throw new Error('stale_months must be an integer >= 1');
  }
  for (const [key, value] of Object.entries(c)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`confidence.${key} must be a number between 0 and 1`);
    }
  }
  // Popularity can never be configured into a trust signal.
  c.helpful_max = Math.min(c.helpful_max, MAX_POPULARITY_BONUS);
  c.reuse_max = Math.min(c.reuse_max, MAX_POPULARITY_BONUS);

  return cfg;
}

/**
 * @param {object} item   One public InfoDot candidate (contract 1 in the README).
 * @param {Date|string|number} now
 * @param {object} [config]  Overrides merged over DEFAULT_CONFIG.
 * @returns {{verdict: 'recommend_for_library'|'watch'|'do_not_recommend', confidence: number,
 *   rationale: {rule: string, effect: string, detail: string}[], rule_version: string}}
 */
export function scoreCandidate(item, now, config = {}) {
  const cfg = resolveConfig(config);
  const c = cfg.confidence;
  const nowMs = toMs(now);
  if (nowMs === null) {
    throw new TypeError('scoreCandidate needs a valid `now`');
  }
  const rationale = [];
  const note = (rule, effect, detail) => rationale.push({ rule, effect, detail });

  let blocked = false; // do_not_recommend
  let held = false; // watch
  const it = item && typeof item === 'object' ? item : {};

  // (a) Input sanity and public status. Fail closed: anything but an explicit
  // `false` for hidden/reversed is treated as not public.
  const created = toMs(it.created_at);
  const edited = it.edited_at == null ? null : toMs(it.edited_at);
  if (typeof it.contribution_ref !== 'string' || it.contribution_ref === '' || !KINDS.includes(it.kind)
      || created === null || (it.edited_at != null && edited === null)) {
    blocked = true;
    note('input', 'block', 'The candidate is missing a reference, a known kind or a valid date, so it cannot be judged.');
  }

  if (it.hidden !== false || it.reversed !== false) {
    blocked = true;
    note('public', 'block', it.hidden === true
      ? 'Hidden by moderation, so it is not public.'
      : it.reversed === true
        ? 'The acceptance or verification was reversed.'
        : 'Not explicitly marked visible and un-reversed; treated as not public.');
  } else {
    note('public', 'pass', 'Public, not hidden, not reversed.');
  }

  // (c) Topics.
  const topics = Array.isArray(it.topics) ? it.topics.filter((t) => typeof t === 'string' && t.trim() !== '') : [];
  if (topics.length === 0) {
    blocked = true;
    note('topics', 'block', 'No topic, so a moderator could not file it in the library.');
  } else {
    note('topics', 'pass', `${topics.length} topic(s).`);
  }

  // (b) Independent corroboration. The flags are InfoDot's own determination
  // that the accepter / verifier is not the author; Brain cannot see who they
  // are and does not try to.
  const accepted = it.accepted_by_independent === true;
  const verified = it.verified_by_independent === true;
  if (!accepted && !verified) {
    blocked = true;
    note('corroboration', 'block', 'Not accepted by anyone other than the author and not verified by an independent moderator.');
  } else {
    note('corroboration', 'pass', accepted && verified
      ? 'Accepted by a non-author and verified by an independent moderator.'
      : accepted ? 'Accepted by a non-author.' : 'Verified by an independent moderator.');
  }

  // (d) Settled: stability over time.
  const corroboratedAt = [accepted ? toMs(it.accepted_at) : null, verified ? toMs(it.verified_at) : null]
    .filter((ms) => ms !== null);
  const earliest = corroboratedAt.length ? Math.min(...corroboratedAt) : null;
  const settleMs = cfg.settle_days * DAY_MS;
  let settledFor = null;

  if ((accepted || verified) && earliest === null) {
    held = true;
    note('settled', 'hold', 'Corroborated, but InfoDot gave no corroboration time, so stability cannot be measured.');
  } else if (earliest !== null) {
    settledFor = nowMs - earliest;
    const sinceEdit = edited === null ? null : nowMs - edited;
    if (settledFor < settleMs) {
      held = true;
      note('settled', 'hold', `Corroborated ${fmtDays(settledFor)} ago; waiting for ${cfg.settle_days} days.`);
    } else if (sinceEdit !== null && sinceEdit < settleMs) {
      held = true;
      note('settled', 'hold', `Edited ${fmtDays(sinceEdit)} ago; waiting for ${cfg.settle_days} days without an edit.`);
    } else {
      note('settled', 'pass', `Corroborated ${fmtDays(settledFor)} ago with no edit in the last ${cfg.settle_days} days.`);
    }
  }

  // (f) Staleness, measured from the latest activity on the content.
  const reuse = nonNegInt(it.reuse_count);
  const latest = created === null ? null : Math.max(created, edited ?? created);
  if (latest !== null) {
    if (reuse === 0 && latest <= subtractMonths(nowMs, cfg.stale_months)) {
      held = true;
      note('stale', 'hold', `No activity for ${cfg.stale_months} months or more and never reused; watching, not recommending.`);
    } else {
      note('stale', 'pass', reuse > 0 ? 'Has been reused.' : `Activity within the last ${cfg.stale_months} months.`);
    }
  }

  const verdict = blocked ? 'do_not_recommend' : held ? 'watch' : 'recommend_for_library';

  // (e) Confidence: earned from corroboration, bounded popularity nudge.
  const corroborated = accepted || verified;
  let confidence = c.base;
  if (corroborated) {
    if (accepted) confidence += c.accepted_by_independent;
    if (verified) confidence += c.verified_by_independent;
    if (accepted && verified) confidence += c.both_corroborations;
    if (settledFor !== null && settledFor >= 2 * settleMs) confidence += c.long_settled;

    const helpfulBonus = popularityBonus(it.helpful_count, c.helpful_per_vote, c.helpful_max);
    const reuseBonus = popularityBonus(it.reuse_count, c.reuse_per_use, c.reuse_max);
    confidence += helpfulBonus + reuseBonus;
    note('popularity', helpfulBonus + reuseBonus > 0 ? 'boost' : 'none',
      `Helpful votes and reuse add at most ${round(helpfulBonus + reuseBonus)} to confidence (cap ${round(c.helpful_max + c.reuse_max)}) and never change the verdict.`);
  } else {
    note('popularity', 'ignored', 'Helpful votes and reuse count for nothing without independent corroboration.');
  }
  note('reputation', 'ignored', 'Points, author standing and volume are not inputs; the author is not even read.');

  const ceiling = blocked ? c.blocked_ceiling : held ? c.watch_ceiling : c.ceiling;
  confidence = Math.min(confidence, ceiling);
  if (blocked && (it.hidden !== false || it.reversed !== false)) {
    confidence = 0; // withdrawn content carries no case at all
  }

  return {
    verdict,
    confidence: round(confidence),
    rationale,
    rule_version: RULE_VERSION,
  };
}

/** `rule: detail` strings, in order, for the schema's decision.rationale[]. */
export function rationaleLines(rationale) {
  return rationale.map((r) => `${r.rule}: ${r.detail}`);
}

function popularityBonus(count, per, max) {
  return Math.min(max, nonNegInt(count) * per);
}

function nonNegInt(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function toMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function subtractMonths(ms, months) {
  const d = new Date(ms);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.getTime();
}

function round(n) {
  return Number(n.toFixed(3));
}

function fmtDays(ms) {
  return `${Math.floor(ms / DAY_MS)} day(s)`;
}
