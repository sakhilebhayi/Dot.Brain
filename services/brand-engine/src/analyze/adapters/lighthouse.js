// services/brand-engine/src/analyze/adapters/lighthouse.js
//
// Lighthouse JSON (the "LHR": `lighthouse <url> --output=json`).
//
// FORMAT (the fields read): { lighthouseVersion, requestedUrl?, finalUrl?,
//   finalDisplayedUrl?, categories: { accessibility?: { score, auditRefs[] },
//   "best-practices"?: {...}, performance?: {...} },
//   audits: { "<id>": { score: 0..1 | null, scoreDisplayMode, title } } }
//
// WHAT IS SCORED. The rubric measures the things listed in its checks, and
// Lighthouse measures other things. So only what matches a rubric check
// becomes evidence, and everything else is recorded as a note, never scored:
//   accessibility category  ->  d8.axe_violations: share of the category's
//        applicable audits that pass (Lighthouse's accessibility audits are
//        axe-core rules; an axe-core report, when supplied, wins over this).
//        It is audit-level, not element-level, and the detail says so. It is
//        deliberately NOT mapped to d8.labels_alt_lang (an element-level share
//        the audits cannot give) or d8.focus_visible.
//   best-practices and performance categories: no rubric check measures what
//        they measure (the rubric has no performance or HTTPS check, and its
//        d4/d10 checks are about overflow, motion, error pages, health and
//        error copy). Their scores are noted and NOT turned into evidence.
// A failed audit becomes a finding of severity "major" (Lighthouse does not
// carry a WCAG level, so none is a blocker; it is never guessed).
// Several reports (one per page) are pooled: an audit fails if it fails on any.
import { REPORT_LIMITS, TEXT_LIMITS } from '../limits.js';
import { safeText } from '../text.js';
import { AdapterError, isObject, pageLabel, parseJson, refName } from './common.js';

export const NAME = 'lighthouse';
export const PRIORITY = 20;
export const PRODUCES = ['d8.axe_violations'];

const AUDIT_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const CATEGORIES = ['accessibility', 'best-practices', 'performance'];

export const matchesName = (name) => /(?:lighthouse|lhr)[^/]*\.json$/i.test(name);
export const sniff = (value) => isObject(value) && typeof value.lighthouseVersion === 'string' && isObject(value.categories) && isObject(value.audits);

const applicable = (a) => isObject(a) && (a.scoreDisplayMode === 'binary' || a.scoreDisplayMode === 'numeric') && typeof a.score === 'number';

export function ingest(inputs, { sink }) {
  const a11y = new Map(); // audit id -> pass (false wins)
  const titles = new Map();
  const pagesFor = new Map(); // audit id -> Set of page labels where it failed
  const notes = [];
  const sources = [];
  let reports = 0;

  for (const input of inputs) {
    const lhr = parseJson(NAME, input.name, input.text);
    if (!sniff(lhr)) throw new AdapterError(NAME, input.name, 'must have lighthouseVersion, categories and audits (a Lighthouse JSON report)');
    reports += 1;
    sources.push(refName(input.name));
    const label = pageLabel(lhr.finalDisplayedUrl ?? lhr.finalUrl ?? lhr.requestedUrl, sink);
    const auditCount = Object.keys(lhr.audits).length;
    if (auditCount > REPORT_LIMITS.maxFindings) throw new AdapterError(NAME, input.name, 'has too many audits');

    const cat = lhr.categories.accessibility;
    if (isObject(cat) && Array.isArray(cat.auditRefs)) {
      for (const ref of cat.auditRefs.slice(0, 500)) {
        if (!isObject(ref) || typeof ref.id !== 'string' || !AUDIT_ID.test(ref.id)) continue;
        const audit = lhr.audits[ref.id];
        if (!applicable(audit)) continue;
        const pass = audit.score === 1;
        a11y.set(ref.id, (a11y.get(ref.id) ?? true) && pass);
        titles.set(ref.id, safeText(audit.title ?? ref.id, 160, sink));
        if (!pass) {
          if (!pagesFor.has(ref.id)) pagesFor.set(ref.id, new Set());
          pagesFor.get(ref.id).add(label);
        }
      }
    }
    for (const c of CATEGORIES) {
      const entry = lhr.categories[c];
      if (isObject(entry) && typeof entry.score === 'number' && entry.score >= 0 && entry.score <= 1) {
        notes.push(`lighthouse ${refName(input.name)}: ${c} category ${(Math.trunc(entry.score * 100))}/100${c === 'accessibility' ? '' : ' (noted, not scored: no rubric check measures it)'}`);
      }
    }
  }

  const evidence = [];
  const findings = [];
  const ref = sources.length === 1 ? sources[0] : `${sources[0]}+${sources.length - 1}`;
  if (a11y.size > 0) {
    const pass = [...a11y.values()].filter(Boolean).length;
    evidence.push({
      check_id: 'd8.axe_violations', value: pass / a11y.size,
      detail: `${pass} of ${a11y.size} applicable Lighthouse accessibility audits pass across ${reports} report(s) (audit-level, from Lighthouse's embedded axe-core rules).`,
      artifact_ref: ref, origin: `adapter:${NAME}`,
    });
  }
  const failed = new Set([...a11y].filter(([, ok]) => !ok).map(([id]) => id));
  for (const id of [...failed].sort()) {
    const check = 'd8.axe_violations';
    const where = [...(pagesFor.get(id) ?? [])].sort();
    for (const page of where.length ? where : ['(page)']) {
      findings.push({
        source_id: id,
        severity: 'major',
        dimension: 'accessibility_inclusion',
        check_id: check,
        message: `Lighthouse audit ${id} fails: ${titles.get(id) ?? id}`.slice(0, TEXT_LIMITS.message),
        fix_hint: 'Fix what the Lighthouse audit reports, then re-run Lighthouse and supply the new report.',
        location: { file: page },
        origin: `adapter:${NAME}`,
      });
    }
  }
  return { evidence, findings, notes: [...new Set(notes)].sort() };
}
