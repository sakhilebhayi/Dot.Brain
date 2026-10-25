// services/brand-engine/src/score/engine.js
//
// scoreReport(evidence, rubric, profile, ctx) -> report. PURE and
// DETERMINISTIC: no clock, no file, no network, no environment, no model.
// The same inputs give a byte-identical report.
//
// How a dimension is scored (see README, "Scoring"):
//   weight w is split by the rubric into three shares that sum to 1:
//     automated a, expert x, observed-or-customer o.
//   cap_without_observed_or_customer = a + x = 1 - o, so without observed or
//   customer evidence a dimension can earn at most w x cap, and the rest is
//   reserved for people actually using the product.
//     automated points = w x a x (sum of check weight x result / 100)
//     expert points    = w x x x (mean level / 4) x (0.5 if AI-only else 1)
//     observed points  = w x o x (sum of metric weight x result / 100)
//   A check or metric nobody measured counts as ZERO and is listed; it is
//   never excluded and never estimated (brain.autonomy.md, section 3).
//   A blocking finding then caps the whole dimension at w x max_fraction, so
//   nothing a brand rule earns elsewhere can lift a dimension a safety,
//   security or accessibility finding has lowered (ADR-0021, decision 8).
import { ENGINE_VERSION, EvidenceError, REPORT_VERSION, REPORT_VERSION_DECLARATIONS } from './constants.js';
import { validateEvidence } from './evidence.js';
import { matchProhibited, rubricHash } from './rubric.js';
import { say } from './text.js';
import { canonicalHash, mean, settle, trunc } from './util.js';

const PROFILE_FIELDS = ['id', 'kind', 'version', 'effective_status', 'chain'];
const t4 = (x) => trunc(x, 4);
const t2 = (x) => trunc(x, 2);
const fmt = (x) => t2(x).toFixed(2);
const resultOf = (v) => (v === 1 ? 'pass' : v === 0 ? 'fail' : 'partial');
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function classifyFindings(evidence, rubric) {
  const effects = new Map(rubric.finding_effects.map((f) => [f.kind, f]));
  return [...evidence.findings].sort((a, b) => byText(a.id, b.id)).map((f) => {
    const effect = effects.get(f.kind);
    let blocker = effect.blocker;
    if (f.kind === 'wcag_failure') blocker = effect.blocker_levels.includes(f.level);
    if (f.kind === 'ethics_gate_flag' && f.resolved === true) blocker = false;
    return { finding: f, effect, blocker, dimension: effect.dimension ?? f.dimension ?? null };
  });
}

function blockerText(item) {
  const { finding: f } = item;
  switch (f.kind) {
    case 'wcag_failure': return say('blocker_wcag_failure', { level: f.level, criterion: f.criterion });
    case 'unsupported_claim': return say('blocker_unsupported_claim');
    case 'failing_test': return say('blocker_failing_test');
    case 'domain_override_violation': return say('blocker_domain_override_violation');
    default: return say('blocker_ethics_gate_flag');
  }
}

function scoreDimension(dim, evidence, rubric, env) {
  const w = dim.weight;
  const aShare = dim.shares.automated_check;
  const xShare = dim.shares.expert_assessment;
  const oShare = dim.shares.observed_or_customer;
  const cap = dim.cap_without_observed_or_customer;
  const entries = [];
  const rejected = [];

  // ----- automated -----
  const checks = dim.evidence.automated_check.checks;
  const suppliedChecks = new Map(evidence.automated.map((e) => [e.check_id, e]));
  let autoSum = 0;
  let autoMeasuredWeight = 0; // weight of the measured checks that can be compared with an expert level
  let measuredWeightAll = 0; // weight of every measured check, saturated or not
  let autoMeasuredSum = 0;
  let checksMeasured = 0;
  const saturatedChecks = [];
  for (const c of checks) {
    const e = suppliedChecks.get(c.id);
    if (!e) {
      entries.push({ source_class: 'automated_check', check_id: c.id, result: 'not_measured', disposition: 'not_measured', detail: say('not_measured_check') });
      continue;
    }
    checksMeasured += 1;
    autoSum += c.weight * e.value;
    measuredWeightAll += c.weight;
    // A saturated result is scored as given (nothing is invented) but is a floor, not a level: it stays out of the
    // automated-versus-expert comparison and of the "automated source" that confidence counts.
    if (e.saturated === true) saturatedChecks.push(c.id);
    else {
      autoMeasuredWeight += c.weight;
      autoMeasuredSum += c.weight * e.value;
    }
    entries.push({
      source_class: 'automated_check', check_id: c.id, result: resultOf(e.value), value: e.value, disposition: 'counted',
      ...(e.detail !== undefined ? { detail: e.detail } : {}), artifact_ref: e.artifact_ref,
      ...(e.saturated === true ? { saturated: true } : {}),
    });
  }
  const autoPoints = w * aShare * (autoSum / 100);
  const autoNotMeasured = w * aShare * (1 - measuredWeightAll / 100);
  const autoMeasuredLevel = autoMeasuredWeight > 0 ? (autoMeasuredSum / autoMeasuredWeight) * 4 : null;

  // ----- expert -----
  const expertAllowed = dim.evidence.expert_assessment.allowed;
  const expertEntries = evidence.expert.filter((e) => e.dimension === dim.id).sort((a, b) => byText(a.assessor, b.assessor));
  const kindOf = (id) => env.assessorKind.get(id);
  let counted = [];
  let corroborating = [];
  let aiOnly = false;
  const expertRows = [];
  if (!expertAllowed) {
    for (const e of expertEntries) {
      const row = { source_class: 'expert_assessment', assessor: e.assessor, result: 'rejected', disposition: 'rejected', reason_code: 'class_not_allowed', detail: say('rejected_class_not_allowed', { source_class: 'expert_assessment' }), artifact_ref: e.artifact_ref };
      expertRows.push(row);
      rejected.push({ dimension: dim.id, source_class: 'expert_assessment', ref: e.assessor, reason_code: 'class_not_allowed', text: row.detail });
    }
  } else {
    const independent = expertEntries.filter((e) => e.assessor !== env.builder);
    const builtIt = expertEntries.filter((e) => e.assessor === env.builder);
    if (independent.length === 0) {
      for (const e of builtIt) {
        const row = { source_class: 'expert_assessment', assessor: e.assessor, result: 'rejected', disposition: 'rejected', reason_code: 'builder_sole_assessor', detail: say('rejected_builder_sole_assessor', { assessor: e.assessor }), artifact_ref: e.artifact_ref };
        expertRows.push(row);
        rejected.push({ dimension: dim.id, source_class: 'expert_assessment', ref: e.assessor, reason_code: 'builder_sole_assessor', text: row.detail });
      }
    } else {
      for (const e of builtIt) {
        expertRows.push({ source_class: 'expert_assessment', assessor: e.assessor, result: `level_${e.level}`, value: e.level / 4, disposition: 'recorded_not_counted', reason_code: 'builder_not_counted', detail: say('recorded_builder_not_counted', { assessor: e.assessor }), artifact_ref: e.artifact_ref });
      }
    }
    const humans = independent.filter((e) => kindOf(e.assessor) === 'human');
    const ais = independent.filter((e) => kindOf(e.assessor) === 'ai');
    if (humans.length) { counted = humans; corroborating = ais; } else { counted = ais; aiOnly = counted.length > 0; }
    for (const e of counted) {
      expertRows.push({ source_class: 'expert_assessment', assessor: e.assessor, result: `level_${e.level}`, value: e.level / 4, disposition: 'counted', detail: e.rationale, artifact_ref: e.artifact_ref });
    }
    for (const e of corroborating) {
      expertRows.push({ source_class: 'expert_assessment', assessor: e.assessor, result: `level_${e.level}`, value: e.level / 4, disposition: 'corroborating', detail: say('corroborating_ai'), artifact_ref: e.artifact_ref });
    }
    if (expertEntries.length === 0) {
      expertRows.push({ source_class: 'expert_assessment', result: 'not_measured', disposition: 'not_measured', detail: say('not_measured_expert') });
    }
  }
  expertRows.sort((a, b) => byText(a.assessor ?? '', b.assessor ?? ''));
  entries.push(...expertRows);
  const expertLevel = counted.length ? mean(counted.map((e) => e.level)) : null;
  const rawExpert = expertLevel === null ? 0 : w * xShare * (expertLevel / 4);
  const credit = aiOnly ? env.aiCredit : 1;
  const expertPoints = rawExpert * credit;
  const withheld = rawExpert - expertPoints;
  const expertNotMeasured = counted.length ? 0 : (expertAllowed ? w * xShare : 0);

  // ----- observed and customer -----
  const metricDefs = [...dim.evidence.observed_behaviour.metrics, ...dim.evidence.customer_feedback.metrics];
  const observedEntries = evidence.observed.filter((e) => e.dimension === dim.id);
  let obsSum = 0;
  let obsMeasuredWeight = 0;
  let obsCounted = 0;
  const obsClasses = new Set();
  const suppliedFor = new Map();
  const prohibitedRows = [];
  for (const e of observedEntries) {
    const prohibited = matchProhibited(rubric, e.metric_id);
    if (prohibited) {
      const text = say('rejected_prohibited_engagement_metric', { metric_id: e.metric_id });
      prohibitedRows.push({ source_class: e.source_class, metric_id: e.metric_id, result: 'rejected', disposition: 'rejected', reason_code: 'prohibited_engagement_metric', n: e.n, detail: text, artifact_ref: e.artifact_ref });
      rejected.push({ dimension: dim.id, source_class: e.source_class, ref: e.metric_id, reason_code: 'prohibited_engagement_metric', text, requires_human_review: true });
    } else suppliedFor.set(e.metric_id, e);
  }
  for (const m of metricDefs) {
    const cls = dim.evidence.observed_behaviour.metrics.includes(m) ? 'observed_behaviour' : 'customer_feedback';
    const e = suppliedFor.get(m.id);
    if (!e) {
      entries.push({ source_class: cls, metric_id: m.id, result: 'not_measured', disposition: 'not_measured', detail: say('not_measured_metric') });
      continue;
    }
    if (!dim.evidence[cls].allowed) {
      const text = say('rejected_class_not_allowed', { source_class: cls });
      entries.push({ source_class: cls, metric_id: m.id, result: 'rejected', disposition: 'rejected', reason_code: 'class_not_allowed', n: e.n, detail: text, artifact_ref: e.artifact_ref });
      rejected.push({ dimension: dim.id, source_class: cls, ref: m.id, reason_code: 'class_not_allowed', text });
      continue;
    }
    if (e.n < env.minN) {
      const text = say('rejected_below_minimum_n', { n: e.n, minimum: env.minN });
      entries.push({ source_class: cls, metric_id: m.id, result: 'rejected', disposition: 'rejected', reason_code: 'below_minimum_n', n: e.n, detail: text, artifact_ref: e.artifact_ref });
      rejected.push({ dimension: dim.id, source_class: cls, ref: m.id, reason_code: 'below_minimum_n', text });
      continue;
    }
    obsCounted += 1;
    obsMeasuredWeight += m.weight;
    obsSum += m.weight * e.value;
    obsClasses.add(cls);
    entries.push({
      source_class: cls, metric_id: m.id, result: 'measured', value: e.value, n: e.n, disposition: 'counted',
      detail: e.detail ?? e.method, artifact_ref: e.artifact_ref,
    });
  }
  prohibitedRows.sort((a, b) => byText(a.metric_id, b.metric_id));
  entries.push(...prohibitedRows);
  const hasObserved = obsCounted > 0;
  const obsPoints = w * oShare * (obsSum / 100);
  const obsNotMeasured = hasObserved ? w * oShare * (1 - obsMeasuredWeight / 100) : 0;

  // ----- total, caps, findings -----
  let raw = autoPoints + expertPoints + obsPoints;
  const ceilingPoints = hasObserved ? w : w * cap;
  const capped = !hasObserved;
  const cappedAway = capped ? w * oShare : 0;

  const applicable = env.findings.filter((f) => f.blocker && f.dimension === dim.id && f.effect.max_fraction < 1);
  let findingCap = null;
  if (applicable.length) {
    const maxFraction = Math.min(...applicable.map((f) => f.effect.max_fraction));
    const limit = w * maxFraction;
    const after = Math.min(raw, limit);
    findingCap = { max_fraction: maxFraction, finding_ids: applicable.map((f) => f.finding.id), points_removed: t4(raw - after) };
    raw = after;
  }
  const earned = raw;

  const anyEvidence = checksMeasured > 0 || counted.length > 0 || hasObserved;
  const autoComplete = !dim.evidence.automated_check.allowed || checksMeasured === checks.length;
  const expertComplete = !expertAllowed || counted.length > 0;
  const obsComplete = !hasObserved || obsCounted === metricDefs.length;
  const status = !anyEvidence ? 'not_measured' : (autoComplete && expertComplete && obsComplete ? 'scored' : 'partially_evidenced');

  const floorBasis = w * cap;
  const floorAttainment = cap > 0 ? Math.min(1, settle(earned) / floorBasis) : null;
  const floorMet = cap > 0 ? settle(floorAttainment) >= dim.floor : null;

  // Disagreement: the automated result (as a level 0-4) and every independent assessor's level.
  const levels = [...counted, ...corroborating].map((e) => e.level);
  if (autoMeasuredLevel !== null && levels.length) levels.push(settle(autoMeasuredLevel));
  let disagreement = null;
  if (levels.length >= 2) {
    const lo = Math.min(...levels);
    const hi = Math.max(...levels);
    if (settle(hi - lo) > env.disagreementLevels) {
      disagreement = { dimension: dim.id, text: say('disagreement_detail', { low: settle(lo), high: settle(hi), levels: env.disagreementLevels }) };
    }
  }

  const classes = new Set();
  if (checksMeasured - saturatedChecks.length > 0) classes.add('automated_check');
  if (counted.length > 0) classes.add('expert_assessment');
  for (const c of obsClasses) classes.add(c);

  const report = {
    id: dim.id,
    name: dim.name,
    weight: w,
    status,
    points_possible: w,
    ceiling_points: t4(ceilingPoints),
    points_earned: t4(earned),
    points_not_measured: t4(autoNotMeasured + expertNotMeasured + obsNotMeasured),
    cap_applied: { applied: capped, cap_fraction: cap, points_capped_away: t4(cappedAway) },
    ...(findingCap ? { finding_cap: findingCap } : {}),
    components: {
      automated_check: {
        allowed: dim.evidence.automated_check.allowed, points_possible: t4(w * aShare), points_earned: t4(autoPoints), checks_total: checks.length, checks_measured: checksMeasured,
        ...(saturatedChecks.length ? { checks_saturated: saturatedChecks.length } : {}),
      },
      expert_assessment: {
        allowed: expertAllowed, points_possible: t4(w * xShare), points_earned: t4(expertPoints), assessors_counted: counted.length,
        ai_only: aiOnly, points_withheld_ai_only: t4(withheld),
      },
      observed_or_customer: { allowed: oShare > 0, points_possible: t4(w * oShare), points_earned: t4(obsPoints), metrics_total: metricDefs.length, metrics_measured: obsCounted },
    },
    floor: dim.floor,
    ...(floorAttainment === null ? {} : { floor_attainment_percent: t2(floorAttainment * 100), floor_met: floorMet }),
    evidence: entries,
  };
  return {
    report, earned, ceilingPoints, rejected, classes, disagreement, saturatedChecks,
    hasObserved, floorMet, anyCounted: counted.length > 0, hasAuto: checksMeasured > 0, hasObservedClass: obsClasses,
  };
}

export function scoreReport(evidence, rubric, profile, ctx = {}) {
  const problems = validateEvidence(evidence, rubric);
  const profileProblems = [];
  if (profile === null || typeof profile !== 'object') profileProblems.push('profile must be a resolved profile');
  else for (const f of PROFILE_FIELDS) if (profile[f] === undefined) profileProblems.push(`profile is missing ${f}; pass a resolved profile`);
  if (problems.length || profileProblems.length) throw new EvidenceError([...problems, ...profileProblems]);

  const policy = rubric.policy;
  const rubricSha = rubricHash(rubric);
  const env = {
    assessorKind: new Map(evidence.assessors.map((a) => [a.id, a.kind])),
    builder: evidence.built_by,
    aiCredit: policy.ai_only_expert_credit,
    minN: policy.observed_minimum_n,
    disagreementLevels: policy.disagreement_levels,
    findings: classifyFindings(evidence, rubric),
  };

  const parts = rubric.dimensions.map((d) => scoreDimension(d, evidence, rubric, env));
  const dims = parts.map((p) => p.report);

  const evidenced = settle(parts.reduce((s, p) => s + p.earned, 0));
  const ceiling = settle(parts.reduce((s, p) => s + p.ceilingPoints, 0));
  const attainment = ceiling > 0 ? settle((evidenced / ceiling) * 100) : 0;

  // ----- blockers and findings -----
  const blockers = env.findings.filter((f) => f.blocker).map((f) => ({
    code: f.finding.kind, finding_id: f.finding.id, kind: f.finding.kind,
    ...(f.dimension ? { dimension: f.dimension } : {}),
    text: blockerText(f), artifact_ref: f.finding.artifact_ref,
  }));
  const findingsRecorded = env.findings.map((f) => {
    let text;
    if (f.blocker) text = blockerText(f);
    else if (f.finding.kind === 'wcag_failure') text = say('advisory_wcag_failure', { level: f.finding.level, criterion: f.finding.criterion });
    else text = say('resolved_ethics_gate_flag');
    return {
      id: f.finding.id, kind: f.finding.kind, blocker: f.blocker, ...(f.dimension ? { dimension: f.dimension } : {}),
      text, detail: f.finding.detail, artifact_ref: f.finding.artifact_ref,
    };
  });

  // ----- confidence -----
  const minWeight = policy.confidence_minimum_weight;
  let highWeight = 0;
  let expertAutoWeight = 0;
  parts.forEach((p, i) => {
    const w = rubric.dimensions[i].weight;
    if (p.classes.size >= 2 && (p.classes.has('observed_behaviour') || p.classes.has('customer_feedback'))) highWeight += w;
    if (p.classes.has('automated_check') && p.classes.has('expert_assessment')) expertAutoWeight += w;
  });
  const disagreements = parts.map((p) => p.disagreement).filter(Boolean);
  const confidenceReasons = [];
  let band;
  if (disagreements.length) {
    band = 'Low';
    confidenceReasons.push({ code: 'disagreement', text: say('confidence_low_disagreement', { levels: env.disagreementLevels, count: disagreements.length }) });
  } else if (highWeight >= minWeight) {
    band = 'High';
    confidenceReasons.push({ code: 'independent_sources_with_observed', text: say('confidence_high', { weight: highWeight, minimum: minWeight }) });
  } else if (expertAutoWeight >= minWeight) {
    band = 'Medium';
    confidenceReasons.push({ code: 'automated_and_expert_agree', text: say('confidence_medium', { weight: expertAutoWeight, minimum: minWeight }) });
  } else {
    band = 'Low';
    confidenceReasons.push({ code: 'single_source_or_expert_only', text: say('confidence_low_single_source', { weight: expertAutoWeight, minimum: minWeight }) });
  }
  const saturatedTotal = parts.reduce((n, p) => n + p.saturatedChecks.length, 0);
  if (saturatedTotal > 0) confidenceReasons.push({ code: 'saturated_left_out', text: say('confidence_saturated_left_out', { count: saturatedTotal }) });
  const expertSupplied = evidence.expert.length > 0;
  if (expertSupplied && env.builder === undefined) confidenceReasons.push({ code: 'independence_unverified', text: say('independence_unverified') });

  // ----- state -----
  const ratification = ctx.rubricRatification ?? null;
  const rubricRatified = Boolean(ratification && ratification.rubric_sha256 === rubricSha && ratification.approver?.kind === 'human' && ratification.ratified_at);
  const profileRatified = profile.effective_status === 'ratified';
  const floorFailures = parts.map((p, i) => ({ p, d: rubric.dimensions[i] })).filter(({ p }) => p.floorMet === false);

  const buildUnmet = [];
  if (attainment < policy.build_verified_attainment_minimum) buildUnmet.push({ code: 'attainment_below_minimum', text: say('state_attainment_below_minimum', { attainment: fmt(attainment), minimum: policy.build_verified_attainment_minimum }) });
  if (blockers.length) buildUnmet.push({ code: 'blockers_present', text: say('state_blockers_present', { count: blockers.length }) });
  for (const { p, d } of floorFailures) {
    buildUnmet.push({ code: 'floor_not_met', text: say('state_floor_not_met', { dimension: d.id, value: p.report.floor_attainment_percent.toFixed(2), floor: (d.floor * 100).toFixed(2) }) });
  }
  const buildVerified = buildUnmet.length === 0;

  const needsObserved = new Set(['usability_cognitive_load', 'trust_transparency', 'perceived_demonstrated_value']);
  if (evidence.context.assistive_technology_testing_possible) needsObserved.add('accessibility_inclusion');
  const releaseUnmet = [...buildUnmet];
  if (evidenced < policy.release_evidenced_minimum) releaseUnmet.push({ code: 'evidenced_below_release_minimum', text: say('release_evidenced_below_minimum', { evidenced: fmt(evidenced), minimum: policy.release_evidenced_minimum }) });
  rubric.dimensions.forEach((d, i) => {
    if (needsObserved.has(d.id) && !parts[i].hasObserved) releaseUnmet.push({ code: 'observed_missing', text: say('release_observed_missing', { dimension: d.id }) });
  });
  if (band === 'Low') releaseUnmet.push({ code: 'confidence_below_medium', text: say('release_confidence_below_medium', { band }) });
  if (!profileRatified) releaseUnmet.push({ code: 'profile_not_ratified', text: say('release_profile_not_ratified', { status: profile.effective_status }) });
  if (!rubricRatified) releaseUnmet.push({ code: 'rubric_not_ratified', text: say('release_rubric_not_ratified', { status: 'proposed' }) });
  if (expertSupplied && env.builder === undefined) releaseUnmet.push({ code: 'builder_not_declared', text: say('release_builder_not_declared') });

  let state;
  const stateReasons = [];
  if (!buildVerified) {
    state = 'not_ready';
    stateReasons.push(...buildUnmet);
  } else if (releaseUnmet.length === 0) {
    state = 'release_ready';
    stateReasons.push({ code: 'release_ready_met', text: say('state_release_ready_met') });
  } else {
    state = 'build_verified';
    stateReasons.push({ code: 'build_verified_met', text: say('state_build_verified_met', { attainment: fmt(attainment), minimum: policy.build_verified_attainment_minimum }) });
    stateReasons.push({ code: 'release_ready_not_reached', text: say('state_release_not_reached', { count: releaseUnmet.length }) });
  }

  const missing = dims.flatMap((d) => d.evidence.filter((e) => e.disposition === 'not_measured').map((e) => ({
    dimension: d.id, source_class: e.source_class, ref: e.check_id ?? e.metric_id ?? 'expert_assessment',
  })));

  const used = new Set(evidence.expert.map((e) => e.assessor));
  const report = {
    report_version: saturatedTotal > 0 || evidence.assessors.some((a) => a.declaration !== undefined && used.has(a.id)) ? REPORT_VERSION_DECLARATIONS : REPORT_VERSION,
    header: {
      rubric: {
        id: rubric.id, version: rubric.version, sha256: rubricSha, status: rubricRatified ? 'ratified' : 'proposed',
        ...(rubricRatified ? { ratified_by: ratification.approver.id, ratified_at: ratification.ratified_at } : {}),
      },
      engine_version: ENGINE_VERSION,
      profile: {
        id: profile.id, kind: profile.kind, version: profile.version, sha256: canonicalHash(profile),
        effective_status: profile.effective_status, chain: [...profile.chain],
      },
      input: {
        repo: evidence.input.repo, commit: evidence.input.commit, evidence_sha256: canonicalHash(evidence),
        ...(evidence.input.scope !== undefined ? { scope: evidence.input.scope } : {}),
        ...(evidence.built_by !== undefined ? { built_by: evidence.built_by } : {}),
      },
      generated_at: evidence.generated_at,
      assessors: evidence.assessors.filter((a) => used.has(a.id)).map((a) => ({ id: a.id, kind: a.kind, ...(a.declaration ? { declaration: a.declaration } : {}) })).sort((a, b) => byText(a.id, b.id)),
    },
    headline: { evidenced_score: t2(evidenced), ceiling: t2(ceiling), attainment_percent: t2(attainment), out_of: 100 },
    state,
    state_reasons: stateReasons,
    release_ready_unmet: releaseUnmet,
    confidence: {
      band, reasons: confidenceReasons, disagreements,
      coverage: { independent_sources_weight: highWeight, automated_and_expert_weight: expertAutoWeight, minimum_weight: minWeight },
    },
    dimensions: dims,
    blockers,
    findings_recorded: findingsRecorded,
    rejected_evidence: parts.flatMap((p) => p.rejected),
    missing_evidence: missing,
    domain_overrides: (profile.domain_overrides ?? []).map((d) => ({
      principle: d.principle, yields_to: d.yields_to, reason: d.reason, ...(d.origin ? { origin: d.origin } : {}),
    })).sort((a, b) => byText(`${a.principle}|${a.yields_to}`, `${b.principle}|${b.yields_to}`)),
  };
  return report;
}
