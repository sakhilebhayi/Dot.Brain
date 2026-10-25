// services/brand-engine/src/analyze/plan.js
//
// plan(analysis) -> ranked, implementation-ready TASKS. Pure and deterministic.
// The engine does not edit the product repository (manifesto rule 4): a plan is
// instructions for whoever does, and `verify` is how the result is checked.
//
// GROUPING. Findings with the same check and the same root cause become one
// task. The root cause is the fix hint with numbers, selectors and
// parenthesised detail removed (so "Affected (3 elements): ..." from three
// pages is one fix, not three).
//
// ORDER (the order of `tasks`, rank 1 first):
//   1. blockers before everything else (a task is a blocker if any of its
//      findings is);
//   2. then points per effort, highest first: expected points / effort units
//      (S=1, M=3, L=8). Expected points = the rubric points the check could
//      still earn (weight x automated share x check weight x (1 - current
//      value)), split across the tasks of that check by number of findings.
//      The effort table is an ESTIMATE used for ordering only (tables.js);
//   3. then consistency: dimension order, then task id, so related fixes sit
//      together and the order never depends on input order.
//
// PRECEDENCE (ADR-0021 decision 8). Brand never outranks safety, regulation,
// accessibility, security or functional correctness:
//   - a task in a brand dimension whose principle the profile says yields to a
//     domain concern is WITHHELD (not proposed) while that concern has an open
//     blocker touching the same files (or any blocker, when no file is known);
//   - every proposed task still lists the profile's overrides for its principle.
//
// ENGAGEMENT (Dopemine ethics). A task about retention or outcomes
// (dimensions 11 and 12), about the habit and retention principles, or whose
// text names an engagement metric (streaks, session time, app opens, scroll
// depth, notification click-through, variable reward, time to return and their
// aliases) is flagged `needs_human` and is never ranked or proposed.
import { createHash } from 'node:crypto';
import { ENGINE_VERSION } from '../score/constants.js';
import { indexRubric } from '../score/rubric.js';
import { canonicalHash, normaliseId, trunc } from '../score/util.js';
import { CHECK_KIND } from './finding-kinds.js';
import {
  BRAND_DIMENSIONS, CHECK_PRINCIPLE, DOMAIN_CONCERN, EFFORT_BY_CHECK, EFFORT_ORDER, EFFORT_UNITS,
  ENGAGEMENT_DIMENSIONS, ENGAGEMENT_PRINCIPLES, FILE_BUMP, PRINCIPLE_BY_DIMENSION,
} from './tables.js';
import { byText } from './text.js';

export const PLAN_VERSION = '1.0.0';
const UNIVERSAL_NOTE = 'Accessibility, security, safety, regulation and functional correctness outrank this task. If a change would weaken any of them, stop and ask a person.';
const SKIP_SEVERITY = new Set(['info']);

/** Words that mean "engagement metric" in free text (the rubric's prohibited list, minus the two too common to flag). */
function engagementTerms(rubric) {
  const names = new Set();
  for (const p of rubric.prohibited_metrics) for (const n of [p.id, ...p.aliases]) names.add(normaliseId(n));
  for (const n of ['opens', 'launches']) names.delete(n);
  for (const n of [...names]) if (!n.endsWith('s')) names.add(`${n}s`);
  for (const n of ['gamif', 're_engagement', 'push_notification', 'habit_loop', 'retention_loop', 'engagement_loop']) names.add(n);
  return [...names];
}
const mentionsEngagement = (terms, text) => {
  const padded = `_${normaliseId(text)}_`;
  return terms.find((t) => (t === 'gamif' ? padded.includes('_gamif') : padded.includes(`_${t}_`)));
};

/** The fix hint reduced to its cause: no numbers, no parenthesised detail, nothing after "Affected". */
export function rootCause(f) {
  const base = (f.fix_hint && f.fix_hint.trim() !== '' ? f.fix_hint : f.message)
    .replace(/\s+Affected\b.*$/i, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[0-9]+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return base.slice(0, 100);
}

const bump = (effort) => EFFORT_ORDER[Math.min(EFFORT_ORDER.indexOf(effort) + 1, EFFORT_ORDER.length - 1)];

function lineList(findings) {
  const byFile = new Map();
  for (const f of findings) {
    if (!f.location) continue;
    if (!byFile.has(f.location.file)) byFile.set(f.location.file, new Set());
    if (f.location.line) byFile.get(f.location.file).add(f.location.line);
  }
  return [...byFile].sort(([a], [b]) => byText(a, b)).map(([file, lines]) => ({ file, lines: [...lines].sort((a, b) => a - b) }));
}

/**
 * @param {object} analysis  a verified analysis document
 * @param {object} ctx       {rubric, principles: Map<id, principle>}
 */
export function plan(analysis, { rubric, principles }) {
  const idx = indexRubric(rubric);
  const terms = engagementTerms(rubric);
  const evidenceBy = new Map(analysis.evidence.map((e) => [e.check_id, e]));
  const profile = analysis.profile;
  const productFindings = analysis.findings.filter((f) => !f.engine && !SKIP_SEVERITY.has(f.severity));
  const engineIssues = analysis.findings.filter((f) => f.engine).map((f) => ({ id: f.id, check_id: f.check_id, message: f.message, fix_hint: f.fix_hint }));

  // ----- group -----
  const groups = new Map();
  for (const f of productFindings) {
    const key = `${f.check_id}|${rootCause(f)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  const perCheckTotal = new Map();
  for (const f of productFindings) perCheckTotal.set(f.check_id, (perCheckTotal.get(f.check_id) ?? 0) + 1);

  // ----- open domain concerns (for withholding) -----
  const concerns = productFindings.filter((f) => f.severity === 'blocker' || f.severity === 'major');
  const concernsFor = (yieldsTo) => {
    const def = DOMAIN_CONCERN[yieldsTo];
    if (!def) return [];
    return concerns.filter((f) => def.dimensions.includes(f.dimension) || (f.severity === 'blocker' && def.kinds.includes(f.kind ?? CHECK_KIND[f.check_id])));
  };

  const tasks = [];
  for (const [key, list] of [...groups].sort(([a], [b]) => byText(a, b))) {
    const checkId = list[0].check_id;
    const def = idx.checks.get(checkId);
    const dimension = def?.dimension ?? list[0].dimension;
    const dimDef = idx.dimensions.get(dimension);
    const principle = list.find((f) => f.principle)?.principle ?? CHECK_PRINCIPLE[checkId] ?? PRINCIPLE_BY_DIMENSION[dimension] ?? 'BXP-04';
    const files = lineList(list);
    const blocker = list.some((f) => f.severity === 'blocker');
    const severity = list.map((f) => f.severity).sort((a, b) => ['blocker', 'major', 'minor'].indexOf(a) - ['blocker', 'major', 'minor'].indexOf(b))[0];

    let effort = EFFORT_BY_CHECK[checkId] ?? 'M';
    if (files.length > FILE_BUMP) effort = bump(effort);

    const ev = evidenceBy.get(checkId);
    const checkGain = def && dimDef && ev ? dimDef.weight * dimDef.shares.automated_check * (def.weight / 100) * (1 - ev.value) : 0;
    const expected = checkGain * (list.length / perCheckTotal.get(checkId));
    const unit = EFFORT_UNITS[effort];

    const hints = [...new Set(list.map((f) => f.fix_hint).filter(Boolean))].sort(byText);
    const principleDoc = principles.get(principle);
    const refs = [...new Set(profile.principle_refs.filter((r) => r.principle === principle).map((r) => `${r.via.replace(/[_:]/g, ' ')}${r.non_negotiable ? ' (non-negotiable)' : ''}`))].sort(byText);
    const overrides = profile.domain_overrides.filter((o) => o.principle === principle);

    const text = [list[0].message, hints.join(' '), principleDoc?.title ?? ''].join(' ');
    const hit = mentionsEngagement(terms, text);
    let needsHuman = null;
    const touched = [dimension, ...list.map((f) => f.dimension)];
    if (touched.some((d) => ENGAGEMENT_DIMENSIONS.includes(d))) needsHuman = `A finding in ${touched.find((d) => ENGAGEMENT_DIMENSIONS.includes(d))} is defined by outcomes and engagement; a person decides what, if anything, to change (brain.dopemine.md section 2).`;
    else if (ENGAGEMENT_PRINCIPLES.includes(principle)) needsHuman = `Principle ${principle} concerns habit and retention, which the Dopemine ethics rules reserve for human review.`;
    else if (hit) needsHuman = `The task mentions "${hit.replace(/_/g, ' ')}", an engagement measure that is never a target (brain.dopemine.md section 2).`;

    let withheld = null;
    if (!needsHuman && BRAND_DIMENSIONS.includes(dimension)) {
      const taskFiles = new Set(files.map((f) => f.file));
      for (const o of overrides) {
        const blocking = concernsFor(o.yields_to).filter((c) => {
          const cf = c.location?.file;
          return cf ? taskFiles.has(cf) || (c.severity === 'blocker' && taskFiles.size === 0) : c.severity === 'blocker';
        });
        if (blocking.length) {
          withheld = {
            principle: o.principle, yields_to: o.yields_to, reason: o.reason,
            blocked_by: blocking.map((c) => c.id).sort(byText),
            text: `The profile says ${o.principle} yields to ${o.yields_to.replace(/_/g, ' ')}, and that concern has an open blocker${blocking.some((c) => c.location) ? ' on the same files' : ''}. Fix the blocker first, then re-plan.`,
          };
          break;
        }
      }
    }

    const riskNotes = [];
    if (files.length > FILE_BUMP) riskNotes.push(`Touches ${files.length} files, so it is estimated one size larger.`);
    for (const o of overrides) riskNotes.push(`Profile override: ${o.principle} yields to ${o.yields_to.replace(/_/g, ' ')}: ${o.reason}`);
    if (['accessibility_inclusion', 'trust_transparency', 'reliability_error_recovery', 'functional_completeness'].includes(dimension)) riskNotes.push('This task is itself a domain concern; do not trade it against a brand preference.');
    const riskLevel = effort === 'L' || files.length > 10 ? 'high' : effort === 'M' || overrides.length ? 'medium' : 'low';

    const id = `T-${createHash('sha256').update(key).digest('hex').slice(0, 8)}`;
    tasks.push({
      id,
      title: `Resolve ${checkId}: ${hints[0] ? hints[0].slice(0, 90) : list[0].message.slice(0, 90)}`,
      check_id: checkId,
      severity,
      blocker,
      why: {
        dimension,
        dimension_name: dimDef?.name ?? dimension,
        principle,
        principle_title: principleDoc?.title ?? null,
        rubric_check: checkId,
        profile_ref: `${profile.id}@${profile.version}`,
        profile_standards: refs,
        statement: `${dimDef?.name ?? dimension}: ${(def ? def.measures : 'a finding in this dimension').replace(/\.\s*$/, '')}`,
      },
      findings: list.map((f) => f.id).sort(byText),
      files,
      locations: list.length,
      fix_hints: hints,
      acceptance: {
        check_id: checkId,
        finding_ids: list.map((f) => f.id).sort(byText),
        rule: `Check ${checkId} is measured again and none of the listed findings is present.`,
        re_run: 'brand-engine verify --before <analysis.json> <path> --plan <plan.json> [--reports <dir>]',
      },
      effort,
      expected_points: trunc(expected, 4),
      points_per_effort: trunc(expected / unit, 4),
      risk: { level: riskLevel, notes: riskNotes },
      domain_notes: [UNIVERSAL_NOTE, ...overrides.map((o) => `${o.principle} yields to ${o.yields_to.replace(/_/g, ' ')}: ${o.reason}`)],
      needs_human: needsHuman !== null,
      ...(needsHuman ? { needs_human_reason: needsHuman } : {}),
      ...(withheld ? { withheld } : {}),
      dimension_order: dimDef?.order ?? 99,
    });
  }

  const proposed = tasks.filter((t) => !t.needs_human && !t.withheld);
  proposed.sort((a, b) => (
    (b.blocker ? 1 : 0) - (a.blocker ? 1 : 0)
    || b.points_per_effort - a.points_per_effort
    || a.dimension_order - b.dimension_order
    || byText(a.id, b.id)
  ));
  const strip = ({ dimension_order, ...t }) => t;
  const ranked = proposed.map((t, i) => ({ rank: i + 1, ...strip(t) }));
  const needsHumanTasks = tasks.filter((t) => t.needs_human).sort((a, b) => a.dimension_order - b.dimension_order || byText(a.id, b.id)).map(strip);
  const withheldTasks = tasks.filter((t) => t.withheld && !t.needs_human).sort((a, b) => a.dimension_order - b.dimension_order || byText(a.id, b.id)).map(strip);

  const doc = {
    plan_version: PLAN_VERSION,
    engine_version: ENGINE_VERSION,
    source: {
      analysis_sha256: analysis.integrity.sha256,
      repo: analysis.input.repo, commit: analysis.input.commit,
      profile: { id: profile.id, version: profile.version, effective_status: profile.effective_status },
      rubric: { ...analysis.rubric },
    },
    note: 'Effort and expected points are estimates used only to order work. The engine does not edit the product repository; apply these tasks, then run `brand-engine verify`.',
    tasks: ranked,
    needs_human: needsHumanTasks,
    withheld: withheldTasks,
    engine_issues: engineIssues,
    not_measured: analysis.not_measured,
    counts: {
      proposed: ranked.length, needs_human: needsHumanTasks.length, withheld: withheldTasks.length,
      blockers: ranked.filter((t) => t.blocker).length, findings: productFindings.length,
    },
  };
  doc.integrity = { sha256: canonicalHash(doc) };
  return doc;
}
