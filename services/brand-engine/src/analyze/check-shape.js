// services/brand-engine/src/analyze/check-shape.js
//
// The contract between the engine and a check module, as pure functions.
//
//   module  default-exports { id, dimension, title, appliesTo(ctx), run(ctx) }
//           and lives at checks/<id with "." and "_" as "-">.js
//   result  run(ctx) -> { status: 'measured' | 'not_applicable' | 'not_measured',
//                         evidence: [{ check_id, source_class: 'automated_check',
//                                      result, detail?, artifact_ref? }],
//                         findings: [{ id, severity, dimension, check_id, message,
//                                      location?: { file, line }, fix_hint }] }
//
// `result` is a number from 0 to 1 (1 = best), or the words "pass" (1) and
// "fail" (0); `value` is accepted as a synonym because that is the name the
// evidence file uses. A finding may carry three optional fields that decide
// how it reaches the score: `kind` (wcag_failure, unsupported_claim,
// failing_test, domain_override_violation, ethics_gate_flag), `wcag_level`
// and `wcag_criterion`, and `principle` (BXP-NN).
//
// Anything that does not fit is a contract violation: the engine records the
// check as not_measured with an error finding. It is never a pass.
import { normaliseRel } from './files.js';
import { CHECK_LIMITS, TEXT_LIMITS } from './limits.js';
import { safeText } from './text.js';

export const SEVERITIES = ['blocker', 'major', 'minor', 'info'];
export const STATUSES = ['measured', 'not_applicable', 'not_measured'];
export const FINDING_KINDS = ['wcag_failure', 'unsupported_claim', 'failing_test', 'domain_override_violation', 'ethics_gate_flag'];
export const CHECK_ID = /^d[0-9]{1,2}\.[a-z0-9_]+$/;
const DIMENSION_ID = /^[a-z][a-z_]*$/;
// A module's own finding id is any printable string; the engine derives its own stable ids.
const SOURCE_ID = /^[^\u0000-\u001f\u007f]{1,200}$/u;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** checks/d8-token-pair-contrast.js for d8.token_pair_contrast */
export const fileNameForId = (id) => `${id.replace(/[._]/g, '-')}.js`;

/** Problems with a loaded module's shape (empty list = valid). */
export function validateCheckModule(mod, fileName) {
  const problems = [];
  if (!isObject(mod)) return ['the module must default-export an object'];
  if (typeof mod.id !== 'string' || !CHECK_ID.test(mod.id)) problems.push('id must look like d8.token_pair_contrast');
  else if (fileName !== undefined && fileName !== fileNameForId(mod.id)) problems.push(`file name must be ${fileNameForId(mod.id)} for id ${mod.id}`);
  if (typeof mod.dimension !== 'string' || !DIMENSION_ID.test(mod.dimension)) problems.push('dimension must be a rubric dimension id (lowercase and underscores)');
  if (typeof mod.title !== 'string' || mod.title.trim() === '' || mod.title.length > TEXT_LIMITS.title) problems.push(`title must be a non-empty string of at most ${TEXT_LIMITS.title} characters`);
  if (typeof mod.appliesTo !== 'function') problems.push('appliesTo must be a function');
  if (typeof mod.run !== 'function') problems.push('run must be a function');
  for (const key of Object.keys(mod)) {
    if (!['id', 'dimension', 'title', 'appliesTo', 'run'].includes(key) && !key.startsWith('x-')) problems.push(`unknown property ${key}`);
  }
  return problems;
}

/**
 * Validate and normalise what run() returned. Returns {problems, result}; when
 * there are problems the caller must treat the check as not_measured.
 * Free text is clipped and scrubbed here, so nothing downstream sees raw text.
 */
export function normaliseCheckResult(raw, sink) {
  const problems = [];
  if (!isObject(raw)) return { problems: ['run() must return an object'], result: null };
  for (const key of Object.keys(raw)) if (!['status', 'evidence', 'findings'].includes(key)) problems.push(`unknown property ${key} in the result`);
  if (!STATUSES.includes(raw.status)) problems.push(`status must be one of ${STATUSES.join(', ')}`);
  if (!Array.isArray(raw.evidence)) problems.push('evidence must be an array');
  if (!Array.isArray(raw.findings)) problems.push('findings must be an array');
  if (problems.length) return { problems, result: null };
  if (raw.evidence.length > CHECK_LIMITS.maxEvidencePerCheck) problems.push(`more than ${CHECK_LIMITS.maxEvidencePerCheck} evidence entries`);
  if (raw.findings.length > CHECK_LIMITS.maxFindingsPerCheck) problems.push(`more than ${CHECK_LIMITS.maxFindingsPerCheck} findings`);
  if (problems.length) return { problems, result: null };

  if (raw.status === 'measured' && raw.evidence.length === 0) problems.push('a measured check must return at least one evidence entry');
  if (raw.status !== 'measured' && raw.evidence.length > 0) problems.push(`a ${raw.status} check must not return evidence`);
  if (raw.status === 'not_applicable' && raw.findings.length > 0) problems.push('a not_applicable check must not return findings');

  const evidence = [];
  const seenCheckIds = new Set();
  raw.evidence.forEach((e, i) => {
    const where = `evidence[${i}]`;
    if (!isObject(e)) { problems.push(`${where}: must be an object`); return; }
    for (const key of Object.keys(e)) if (!['check_id', 'source_class', 'result', 'value', 'detail', 'artifact_ref'].includes(key)) problems.push(`${where}: unknown property ${key}`);
    if (typeof e.check_id !== 'string' || !CHECK_ID.test(e.check_id)) problems.push(`${where}: check_id must look like d8.token_pair_contrast`);
    else if (seenCheckIds.has(e.check_id)) problems.push(`${where}: more than one entry for ${e.check_id}`);
    else seenCheckIds.add(e.check_id);
    if (e.source_class !== 'automated_check') problems.push(`${where}: source_class must be "automated_check"`);
    if (e.result !== undefined && e.value !== undefined && e.result !== e.value) problems.push(`${where}: result and value disagree`);
    const r = e.result ?? e.value;
    let value;
    if (r === 'pass') value = 1;
    else if (r === 'fail') value = 0;
    else if (typeof r === 'number' && Number.isFinite(r) && r >= 0 && r <= 1) value = r;
    else problems.push(`${where}: result must be a number from 0 to 1, "pass" or "fail"`);
    if (e.detail !== undefined && typeof e.detail !== 'string') problems.push(`${where}: detail must be a string`);
    if (e.artifact_ref !== undefined && (typeof e.artifact_ref !== 'string' || e.artifact_ref === '')) problems.push(`${where}: artifact_ref must be a non-empty string`);
    if (value !== undefined && typeof e.check_id === 'string') {
      evidence.push({
        check_id: e.check_id,
        value,
        ...(e.detail ? { detail: safeText(e.detail, TEXT_LIMITS.detail, sink) } : {}),
        ...(e.artifact_ref ? { artifact_ref: safeText(e.artifact_ref, 300, sink).replace(/\s+/g, '_') } : {}),
      });
    }
  });

  const findings = [];
  const seenIds = new Set();
  raw.findings.forEach((f, i) => {
    const where = `findings[${i}]`;
    if (!isObject(f)) { problems.push(`${where}: must be an object`); return; }
    const allowed = ['id', 'severity', 'dimension', 'check_id', 'message', 'location', 'fix_hint', 'kind', 'wcag_level', 'wcag_criterion', 'principle'];
    for (const key of Object.keys(f)) if (!allowed.includes(key)) problems.push(`${where}: unknown property ${key}`);
    if (typeof f.id !== 'string' || !SOURCE_ID.test(f.id)) problems.push(`${where}: id must be 1 to 200 printable characters`);
    else if (seenIds.has(f.id)) problems.push(`${where}: duplicate id ${f.id}`);
    else seenIds.add(f.id);
    if (!SEVERITIES.includes(f.severity)) problems.push(`${where}: severity must be one of ${SEVERITIES.join(', ')}`);
    if (typeof f.dimension !== 'string' || !DIMENSION_ID.test(f.dimension)) problems.push(`${where}: dimension must be a rubric dimension id`);
    if (typeof f.check_id !== 'string' || !CHECK_ID.test(f.check_id)) problems.push(`${where}: check_id must look like d8.token_pair_contrast`);
    if (typeof f.message !== 'string' || f.message.trim() === '') problems.push(`${where}: message must be a non-empty string`);
    if (typeof f.fix_hint !== 'string') problems.push(`${where}: fix_hint must be a string`);
    let location;
    if (f.location !== undefined) {
      if (!isObject(f.location)) problems.push(`${where}: location must be an object`);
      else {
        for (const key of Object.keys(f.location)) if (!['file', 'line'].includes(key)) problems.push(`${where}: location has unknown property ${key}`);
        try { location = { file: normaliseRel(f.location.file) }; } catch { problems.push(`${where}: location.file must be a relative path inside the checkout`); }
        if (f.location.line !== undefined) {
          if (!Number.isInteger(f.location.line) || f.location.line < 1 || f.location.line > 10_000_000) problems.push(`${where}: location.line must be a positive integer`);
          else if (location) location.line = f.location.line;
        }
      }
    }
    if (f.kind !== undefined && !FINDING_KINDS.includes(f.kind)) problems.push(`${where}: kind must be one of ${FINDING_KINDS.join(', ')}`);
    if (f.wcag_level !== undefined && !['A', 'AA', 'AAA'].includes(f.wcag_level)) problems.push(`${where}: wcag_level must be A, AA or AAA`);
    if (f.wcag_criterion !== undefined && !(typeof f.wcag_criterion === 'string' && /^[0-9]\.[0-9]{1,2}\.[0-9]{1,2}$/.test(f.wcag_criterion))) problems.push(`${where}: wcag_criterion must look like 1.4.3`);
    if (f.principle !== undefined && !(typeof f.principle === 'string' && /^BXP-[0-9]{2}$/.test(f.principle))) problems.push(`${where}: principle must look like BXP-04`);
    if (typeof f.id === 'string' && SOURCE_ID.test(f.id) && SEVERITIES.includes(f.severity) && typeof f.message === 'string' && typeof f.fix_hint === 'string') {
      findings.push({
        source_id: f.id.replace(/[^A-Za-z0-9_.:-]+/g, '_').slice(0, 80) || 'finding',
        severity: f.severity,
        dimension: f.dimension,
        check_id: f.check_id,
        message: safeText(f.message, TEXT_LIMITS.message, sink),
        fix_hint: safeText(f.fix_hint, TEXT_LIMITS.fixHint, sink),
        ...(location ? { location } : {}),
        ...(f.kind ? { kind: f.kind } : {}),
        ...(f.wcag_level ? { wcag_level: f.wcag_level } : {}),
        ...(f.wcag_criterion ? { wcag_criterion: f.wcag_criterion } : {}),
        ...(f.principle ? { principle: f.principle } : {}),
      });
    }
  });

  if (problems.length) return { problems, result: null };
  return { problems, result: { status: raw.status, evidence, findings } };
}
