// services/brand-engine/src/analyze/checks/_lib/define.js
//
// Builds a check module that satisfies the contract shared with the registry:
//
//   default export { id, dimension, title, appliesTo(ctx) -> boolean,
//                    run(ctx) -> { status, evidence[], findings[] } }
//
// The analyzer rejects any other key in the result, so the reason a check is not_measured travels as
// an info finding (rule "not-measured") and the reason it is not_applicable is the status itself.
//
// `measure(repo, ctx, helpers)` is the only thing a check writes. It returns either
//   { value, detail, artifact?, findings }          -> status "measured"
//   { notMeasured: "reason", findings? }            -> status "not_measured"
// and this wrapper does the rest: it refuses a value outside 0..1, orders and numbers the
// findings so the output is deterministic, and never produces a pass without a measurement.
import { openRepo } from './repo.js';

export const DIMENSION_BY_PREFIX = {
  d1: 'emotional_clarity_positioning',
  d2: 'brand_distinctiveness',
  d3: 'usability_cognitive_load',
  d4: 'visual_interaction_craftsmanship',
  d5: 'functional_completeness',
  d6: 'trust_transparency',
  d7: 'perceived_demonstrated_value',
  d8: 'accessibility_inclusion',
  d9: 'cross_platform_consistency',
  d10: 'reliability_error_recovery',
};

export const SEVERITIES = ['blocker', 'major', 'minor', 'info'];
const RANK = Object.fromEntries(SEVERITIES.map((s, i) => [s, i]));
const MAX_DETAIL = 1000;
export const MAX_FINDINGS = 1500; // the analyzer rejects a result with more than 2,000
const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const safeRef = (s) => s.replace(/\s/g, '%20').slice(0, 300);

export function defineCheck({ id, title, noUiReason = 'no user interface sources found (no templates or stylesheets)', applies, measure }) {
  const prefix = id.split('.')[0];
  const dimension = DIMENSION_BY_PREFIX[prefix];
  if (!dimension) throw new Error(`check id ${id}: unknown dimension prefix`);

  const wrapped = {
    id,
    dimension,
    title,
    appliesTo(ctx) {
      const repo = openRepo(ctx);
      return repo.ok && applies(repo, ctx) === true;
    },
    run(ctx) {
      const repo = openRepo(ctx);
      const notMeasured = (reason, raw = []) => ({
        status: 'not_measured',
        evidence: [],
        findings: number(id, dimension, [...raw, { rule: 'not-measured', severity: 'info', message: `Not measured: ${reason}.`.replace(/\.\.$/, '.'), hint: 'Supply what is missing, or accept that this check cannot judge this repository; it counts as zero in the score, visibly.' }]),
      });
      if (!repo.ok) return notMeasured('the checkout root could not be read');
      if (applies(repo, ctx) !== true) return { status: 'not_applicable', evidence: [], findings: [] };

      const out = measure(repo, ctx);
      if (out.notMeasured !== undefined) return notMeasured(out.notMeasured, out.findings ?? []);
      const findings = number(id, dimension, out.findings ?? []);
      const v = out.value;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`${id}: measured value ${v} is not a number in 0..1`);
      }
      const first = findings.find((f) => f.location)?.location?.file;
      return {
        status: 'measured',
        evidence: [{
          check_id: id,
          source_class: 'automated_check',
          result: Math.round(v * 10000) / 10000,
          detail: clip(`${out.detail ?? ''}${repo.coverageNote()}`, MAX_DETAIL),
          artifact_ref: safeRef(out.artifact ?? first ?? `static-scan/${id}`),
        }],
        findings,
      };
    },
  };
  return Object.freeze(wrapped);
}

function number(checkId, dimension, rawIn) {
  let raw = rawIn.map((f) => {
    if (!SEVERITIES.includes(f.severity)) throw new Error(`${checkId}: unknown severity ${f.severity}`);
    return f;
  });
  if (raw.length > MAX_FINDINGS) {
    // Keep the most serious findings and say how many were left out; the value counts all of them.
    const ranked = [...raw].sort((a, b) => RANK[a.severity] - RANK[b.severity] || cmp(a.file ?? '', b.file ?? '') || (a.line ?? 0) - (b.line ?? 0) || cmp(a.rule, b.rule) || cmp(a.message, b.message));
    const dropped = ranked.slice(MAX_FINDINGS - 1);
    const by = SEVERITIES.map((sv) => [sv, dropped.filter((f) => f.severity === sv).length]).filter(([, n]) => n > 0).map(([sv, n]) => `${n} ${sv}`).join(', ');
    raw = [...ranked.slice(0, MAX_FINDINGS - 1), { rule: 'findings-truncated', severity: 'info', message: `${dropped.length} further finding(s) of this check were not listed (${by}); the value counts all of them.`, hint: 'Fix the listed findings first, then re-run to see the rest.' }];
  }
  const sorted = raw.sort((a, b) => cmp(a.file ?? '', b.file ?? '') || (a.line ?? 0) - (b.line ?? 0) || cmp(a.rule, b.rule) || cmp(a.message, b.message));
  const seen = new Map();
  return sorted.map((f) => {
    const n = (seen.get(f.rule) ?? 0) + 1;
    seen.set(f.rule, n);
    const out = {
      id: `${checkId}.${f.rule}.${String(n).padStart(3, '0')}`,
      severity: f.severity,
      dimension,
      check_id: checkId,
      message: clip(f.message, 400),
      fix_hint: clip(f.hint ?? 'Review this item and fix or document why it is acceptable.', 400),
    };
    if (f.file) out.location = { file: f.file, line: f.line ?? 1 };
    // `kind` is set only on blockers: it says "treat this as a finding of that rubric kind". A major or lower
    // finding is a heuristic and must not become a blocker downstream.
    if (f.kind && f.severity === 'blocker') out.kind = f.kind;
    if (f.level) out.wcag_level = f.level; // WCAG level and success criterion, informational below blocker
    if (f.criterion) out.wcag_criterion = f.criterion;
    return out;
  });
}

/** Result value helper: share of `ok` in `total`, refusing 0/0. */
export const share = (ok, total) => (total > 0 ? ok / total : null);

/** Whole-run summary helpers shared by checks. */
export const sevCount = (findings, sev) => findings.filter((f) => f.severity === sev).length;
export { RANK };
