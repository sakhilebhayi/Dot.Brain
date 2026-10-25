// services/brand-engine/src/analyze/analyze.js
//
// analyze(): run every registered check over a checkout, read the reports other
// tools produced, and return ONE document (analysis.json) holding the evidence,
// the findings and an explicit list of what was not measured.
//
// DETERMINISTIC: no clock, no environment, no absolute path, no randomness; the
// same checkout, profile, reports and checks give the same bytes. READ-ONLY: it
// never writes inside the checkout (the CLI refuses an --out inside it).
//
// How the pieces are joined (the rules the tests pin):
//   - a check whose result breaks the contract, throws, loops or crashes is
//     "not_measured" with an engine error finding, never a pass (registry.js);
//   - evidence for a check id counts only if it names a check the rubric defines;
//   - one check id, one source: if a check module and an adapter (or two modules)
//     both produce it, NEITHER is counted and the conflict is reported;
//   - every rubric check with no counted evidence is listed in not_measured with
//     the reason, which is how the score later counts it as zero, visibly.
import { realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { stableStringify } from '../json.js';
import { ENGINE_VERSION } from '../score/constants.js';
import { indexRubric } from '../score/rubric.js';
import { canonicalHash } from '../score/util.js';
import { ingestReports, adaptersFor } from './adapters/index.js';
import { DEFAULT_CHECKS_DIR, runChecks } from './registry.js';
import { createFiles } from './files.js';
import { readGitInfo } from './git.js';
import { ScopeError, assertScopeUsable, parseScope } from './scope.js';
import { CHECK_LIMITS, TEXT_LIMITS } from './limits.js';
import { orderOfCheck } from './tables.js';
import { byText } from './text.js';

export const ANALYSIS_VERSION = '1.0.0';
// 1.1.0 adds one optional field, `evidence[].saturated`. A document names the LOWEST version that can describe it,
// so an analysis that uses nothing new stays byte-identical to what 1.0.0 produced.
export const ANALYSIS_VERSION_SATURATION = '1.1.0';
export const DEFAULT_THEMES = Object.freeze(['light', 'dark']);
const SEVERITY_RANK = { blocker: 0, major: 1, minor: 2, info: 3 };

export class AnalyzeError extends Error {
  constructor(message) { super(message); this.name = 'AnalyzeError'; }
}

const sha = (text) => createHash('sha256').update(text).digest('hex');

/** Cross-check a check outcome against the rubric. Returns a list of problems. */
function crossValidate(outcome, idx) {
  if (outcome.error) return [];
  const problems = [];
  const dim = idx.dimensions.get(outcome.meta.dimension);
  if (!dim) problems.push(`dimension ${outcome.meta.dimension} is not a rubric dimension`);
  else if (orderOfCheck(outcome.meta.id) !== dim.order) problems.push(`id ${outcome.meta.id} does not belong to dimension ${dim.id} (order ${dim.order})`);
  for (const e of outcome.evidence) if (!idx.checks.has(e.check_id)) problems.push(`evidence names ${e.check_id}, which the rubric does not define`);
  for (const f of outcome.findings) {
    if (!idx.dimensions.has(f.dimension)) problems.push(`finding ${f.source_id} names dimension ${f.dimension}, which the rubric does not define`);
    if (!idx.checks.has(f.check_id)) problems.push(`finding ${f.source_id} names ${f.check_id}, which the rubric does not define`);
  }
  return problems;
}

function engineErrorFinding(meta, problems) {
  return {
    source_id: 'check-error', severity: 'major', dimension: meta.dimension, check_id: meta.id,
    message: `The check ${meta.id} did not produce a result (invalid_result): ${problems.slice(0, 3).join('; ')}`.slice(0, TEXT_LIMITS.message),
    fix_hint: 'Fix the check module so its result follows the contract, then re-run analyze. Until then this check counts as not measured.',
    engine: true,
  };
}

/**
 * @param {object} o
 * @param {string} o.root           the checkout (a directory)
 * @param {object} o.profile        a RESOLVED profile (registry.lookupProfile(...).resolved)
 * @param {object} o.profileInfo    {source: 'registry'|'file'}
 * @param {object} o.rubricBundle   from loadRubric
 * @param {string} [o.reportsDir]
 * @param {string} [o.checksDir]
 * @param {string} [o.scope]         comma-separated repo-relative path prefixes; limits the surface the static checks list
 */
export async function analyze({
  root, profile, profileInfo = { source: 'registry' }, rubricBundle, reportsDir, checksDir = DEFAULT_CHECKS_DIR,
  themes = DEFAULT_THEMES, repo, commit, timeoutMs = CHECK_LIMITS.timeoutMs, scope,
}) {
  let realRoot;
  try {
    realRoot = realpathSync(root);
    if (!statSync(realRoot).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new AnalyzeError(`${root} is not a readable directory`);
  }
  const rubric = rubricBundle.rubric;
  const idx = indexRubric(rubric);
  const sink = { redactions: 0, root: realRoot };

  // ----- scope (D1): which surface of the checkout the static checks are about -----
  let scopePrefixes = [];
  let scopeLabel;
  if (scope !== undefined) {
    try {
      const parsed = parseScope(scope);
      assertScopeUsable(parsed.prefixes, realRoot, createFiles(realRoot).api.list(['**/*']));
      scopePrefixes = parsed.prefixes;
      scopeLabel = parsed.label;
    } catch (error) {
      if (error instanceof ScopeError) throw new AnalyzeError(error.message);
      throw error;
    }
  }

  // ----- the checkout's identity -----
  const git = readGitInfo(realRoot);
  if (commit !== undefined && git.commit && commit !== git.commit) throw new AnalyzeError(`--commit ${commit} contradicts the checkout's HEAD ${git.commit}`);
  if (repo !== undefined && git.repo && repo !== git.repo) throw new AnalyzeError(`--repo ${repo} contradicts the checkout's origin ${git.repo}`);
  const input = {
    repo: repo ?? git.repo ?? null,
    commit: git.commit ?? commit ?? null,
    commit_source: git.commit ? 'git' : commit ? 'flag' : 'none',
    ...(scopeLabel ? { scope: scopeLabel } : {}),
  };

  // ----- checks -----
  const { outcomes, loadErrors } = await runChecks(checksDir, { root: realRoot, profile, themes: [...themes], scope: scopePrefixes, timeoutMs, sink });
  const checks = [];
  const evidenceRows = [];
  const findingRows = [];
  const skippedFiles = new Map();
  const engineProblems = loadErrors.map((e) => ({ file: e.file, message: String(e.message).slice(0, 300) }));

  for (let outcome of outcomes) {
    const problems = crossValidate(outcome, idx);
    if (problems.length) {
      outcome = {
        ...outcome, status: 'not_measured', evidence: [], findings: [engineErrorFinding(outcome.meta, problems)],
        error: { code: 'invalid_result', message: problems.slice(0, 3).join('; ').slice(0, 300) },
      };
    }
    checks.push({
      id: outcome.meta.id, dimension: outcome.meta.dimension, title: outcome.meta.title.slice(0, TEXT_LIMITS.title),
      status: outcome.status, ...(outcome.error ? { error: outcome.error } : {}),
    });
    for (const e of outcome.evidence) {
      evidenceRows.push({ check_id: e.check_id, value: e.value, ...(e.detail ? { detail: e.detail } : {}), artifact_ref: e.artifact_ref ?? `check:${outcome.meta.id}`, origin: `check:${outcome.meta.id}` });
    }
    for (const f of outcome.findings) findingRows.push({ ...f, origin: f.engine ? 'engine' : `check:${outcome.meta.id}` });
    for (const s of outcome.skipped ?? []) skippedFiles.set(`${s.reason}|${s.path}`, s);
  }

  // ----- reports from other tools -----
  let reports = { ingested: [], skipped: [], superseded: [], notes: [] };
  if (reportsDir !== undefined) {
    const r = ingestReports(reportsDir, { root: realRoot, sink });
    for (const e of r.evidence) {
      if (!idx.checks.has(e.check_id)) throw new AnalyzeError(`an adapter produced ${e.check_id}, which the rubric does not define`);
      evidenceRows.push(e);
    }
    for (const f of r.findings) findingRows.push(f);
    reports = { ingested: r.ingested, skipped: r.skipped, superseded: r.superseded, notes: r.notes };
  }

  // ----- one check id, one source -----
  const byCheck = new Map();
  for (const e of evidenceRows) {
    if (!byCheck.has(e.check_id)) byCheck.set(e.check_id, []);
    byCheck.get(e.check_id).push(e);
  }
  const evidence = [];
  const conflicts = [];
  for (const [checkId, list] of [...byCheck].sort(([a], [b]) => byText(a, b))) {
    const origins = [...new Set(list.map((e) => e.origin))].sort(byText);
    if (origins.length > 1) {
      conflicts.push({ check_id: checkId, origins });
      findingRows.push({
        source_id: 'evidence-conflict', severity: 'major', dimension: idx.checks.get(checkId).dimension, check_id: checkId,
        message: `More than one source produced ${checkId} (${origins.join(', ')}); none of them is counted.`,
        fix_hint: 'Supply one source for this check (remove the duplicate check module or the overlapping report), then re-run analyze.',
        origin: 'engine', engine: true,
      });
      continue;
    }
    evidence.push({ ...list[0], source_class: 'automated_check', result: list[0].value === 1 ? 'pass' : list[0].value === 0 ? 'fail' : 'partial' });
  }

  // ----- findings: stable ids -----
  const draft = findingRows.map((f) => ({
    ...f,
    dimension: f.dimension,
    origin: f.origin,
  }));
  draft.sort((a, b) => (
    byText(a.check_id, b.check_id)
    || byText(a.location?.file ?? '', b.location?.file ?? '')
    || (a.location?.line ?? 0) - (b.location?.line ?? 0)
    || byText(a.message, b.message) || byText(a.source_id, b.source_id) || byText(a.origin, b.origin)
  ));
  const seen = new Map();
  const findings = draft.map((f) => {
    const base = sha(`${f.check_id}\n${f.location?.file ?? ''}\n${f.message.replace(/\s+/g, ' ')}`).slice(0, 12);
    const ord = seen.get(base) ?? 0;
    seen.set(base, ord + 1);
    const { engine, ...rest } = f;
    return { ...rest, id: `${f.check_id}.${base}${ord ? `.${ord}` : ''}`, fingerprint: `${base}${ord ? `.${ord}` : ''}`, ...(engine ? { engine: true } : {}) };
  });
  findings.sort((a, b) => (SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]) || byText(a.check_id, b.check_id) || byText(a.id, b.id));
  let truncated = false;
  if (findings.length > TEXT_LIMITS.findingsTotal) { findings.length = TEXT_LIMITS.findingsTotal; truncated = true; }

  // ----- what was not measured -----
  const countedIds = new Set(evidence.map((e) => e.check_id));
  const conflicted = new Set(conflicts.map((c) => c.check_id));
  const moduleById = new Map(checks.map((c) => [c.id, c]));
  const ingestedAdapters = new Set(reports.ingested.map((r) => r.adapter));
  const notMeasured = [];
  for (const [checkId, def] of [...idx.checks].sort(([a], [b]) => byText(a, b))) {
    if (countedIds.has(checkId)) continue;
    let reason;
    const mod = moduleById.get(checkId);
    if (conflicted.has(checkId)) reason = 'conflicting_sources';
    else if (mod && mod.status === 'not_applicable') reason = 'not_applicable';
    else if (mod && mod.error) reason = 'check_errored';
    else if (mod) reason = 'check_not_measured';
    else if (adaptersFor(checkId).length) reason = adaptersFor(checkId).some((a) => ingestedAdapters.has(a)) ? 'report_had_no_data' : 'no_report_supplied';
    else reason = 'no_check_registered';
    notMeasured.push({ check_id: checkId, dimension: def.dimension, reason, ...(reason === 'no_report_supplied' ? { adapters: adaptersFor(checkId) } : {}) });
  }

  const skipped = [...skippedFiles.values()].sort((a, b) => byText(`${a.path}|${a.reason}`, `${b.path}|${b.reason}`));
  const counts = { checks: checks.length, evidence: evidence.length, findings: findings.length, by_severity: { blocker: 0, major: 0, minor: 0, info: 0 }, not_measured: notMeasured.length, redactions: sink.redactions, ...(truncated ? { findings_truncated: true } : {}) };
  for (const f of findings) counts.by_severity[f.severity] += 1;

  const doc = {
    analysis_version: evidence.some((e) => e.saturated === true) ? ANALYSIS_VERSION_SATURATION : ANALYSIS_VERSION,
    engine_version: ENGINE_VERSION,
    input,
    rubric: { id: rubric.id, version: rubric.version, sha256: rubricBundle.sha256 },
    profile: {
      id: profile.id, kind: profile.kind, version: profile.version, effective_status: profile.effective_status,
      chain: [...profile.chain], sha256: canonicalHash(profile), source: profileInfo.source,
      domain_overrides: (profile.domain_overrides ?? []).map((d) => ({ principle: d.principle, yields_to: d.yields_to, reason: String(d.reason).slice(0, 500) })),
      principle_refs: [
        ...(profile.experience_standards ?? []).map((s) => ({ principle: s.principle, via: 'experience_standard', non_negotiable: s.non_negotiable === true })),
        ...(profile.behavioural_principles ?? []).filter((b) => b.principle).map((b) => ({ principle: b.principle, via: `behavioural_principle:${b.id}`, non_negotiable: b.non_negotiable === true })),
      ].sort((a, b) => byText(`${a.principle}|${a.via}`, `${b.principle}|${b.via}`)),
    },
    themes: [...themes],
    checks: checks.sort((a, b) => byText(a.id, b.id)),
    evidence,
    findings,
    not_measured: notMeasured,
    conflicts,
    coverage: { skipped: skipped.slice(0, 200), skipped_total: skipped.length },
    reports: { ingested: reports.ingested, skipped: reports.skipped, superseded: reports.superseded, notes: reports.notes },
    engine_problems: engineProblems,
    counts,
  };
  doc.integrity = { sha256: canonicalHash(doc) };
  return doc;
}

/** Verify (and return a problem list for) the self-hash of an analysis/plan document. */
export function integrityProblems(doc) {
  if (!doc || typeof doc !== 'object' || !doc.integrity || typeof doc.integrity.sha256 !== 'string') return ['the document has no integrity hash'];
  const { integrity, ...rest } = doc;
  return canonicalHash(rest) === integrity.sha256 ? [] : ['the document was modified after it was produced (its integrity hash does not match)'];
}

export { stableStringify };
