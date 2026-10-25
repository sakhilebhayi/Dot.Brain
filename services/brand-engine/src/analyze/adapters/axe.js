// services/brand-engine/src/analyze/adapters/axe.js
//
// axe-core results JSON (what `axe.run()` returns, or what `@axe-core/cli
// --save` writes: one object, or an array of objects, one per page).
//
// FORMAT: { testEngine?: { name: "axe-core", version }, url?, timestamp?,
//           violations: [{ id, impact, tags[], help, helpUrl, description,
//                          nodes: [{ target[], html, failureSummary }] }],
//           passes: [{ id, ... }], incomplete?: [...], inapplicable?: [...] }
//
// MEASURE (d8.axe_violations: "share of axe-core rules passing"): over all
// supplied pages, a rule FAILS if it is violated on any page and PASSES if it
// passed on at least one page and violated on none. value = passing rules /
// (passing + failing). "incomplete" (needs review) and "inapplicable" rules
// are not counted either way, and incomplete ones are mentioned in the detail.
//
// FINDINGS: one per violated rule per page, so a fix is visible as the
// finding going away. The message is the rule id and axe's own help text (no
// counts, so it stays the same until the rule passes); the affected selectors
// are in the fix_hint. WCAG: a `wcag2a`/`wcag21a` tag is level A,
// `wcag2aa`/`wcag21aa`/`wcag22aa` level AA, `wcag2aaa` level AAA; a tag such as
// `wcag143` names criterion 1.4.3. A violation with level A or AA and a
// criterion is a blocker of kind wcag_failure (the rubric says any A or AA
// violation raises one). A violation with a level but no criterion tag is a
// blocker too, and `evidence assemble` refuses to guess its criterion.
// AAA and best-practice-only violations are never blockers.
import { REPORT_LIMITS, TEXT_LIMITS } from '../limits.js';
import { safeText } from '../text.js';
import { AdapterError, isObject, pageLabel, parseJson, refName } from './common.js';

export const NAME = 'axe';
export const PRIORITY = 30;
export const PRODUCES = ['d8.axe_violations'];

const RULE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;

export const matchesName = (name) => /axe[^/]*\.json$/i.test(name);
export const sniff = (value) => {
  const one = Array.isArray(value) ? value[0] : value;
  return isObject(one) && Array.isArray(one.violations) && Array.isArray(one.passes);
};

/** {level, criterion} from axe tags. */
export function wcagFromTags(tags) {
  let level;
  let criterion;
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    if (/^wcag2a$|^wcag21a$/.test(t)) level = level ?? 'A';
    else if (/^wcag2aa$|^wcag21aa$|^wcag22aa$/.test(t)) level = level === 'A' ? level : 'AA';
    else if (/^wcag2aaa$/.test(t)) level = level ?? 'AAA';
    const m = /^wcag(\d)(\d)(\d{1,2})$/.exec(t);
    if (m) criterion = `${m[1]}.${m[2]}.${m[3]}`;
  }
  return { level, criterion };
}

function pages(adapterFile, value) {
  const list = Array.isArray(value) ? value : [value];
  if (list.length === 0) throw new AdapterError(NAME, adapterFile, 'contains no results');
  if (list.length > 200) throw new AdapterError(NAME, adapterFile, 'contains more than 200 pages');
  return list;
}

export function ingest(inputs, { sink }) {
  const failing = new Map(); // rule id -> true
  const passing = new Set();
  const findings = [];
  let incomplete = 0;
  let pageCount = 0;
  const sources = [];

  for (const input of inputs) {
    const value = parseJson(NAME, input.name, input.text);
    sources.push(refName(input.name));
    for (const page of pages(input.name, value)) {
      if (!isObject(page) || !Array.isArray(page.violations) || !Array.isArray(page.passes)) throw new AdapterError(NAME, input.name, 'must have "violations" and "passes" arrays (axe-core results)');
      if (isObject(page.testEngine) && page.testEngine.name !== undefined && page.testEngine.name !== 'axe-core') throw new AdapterError(NAME, input.name, `was produced by ${safeText(page.testEngine.name, 40)}, not axe-core`);
      if (page.violations.length > REPORT_LIMITS.maxFindings || page.passes.length > REPORT_LIMITS.maxFindings) throw new AdapterError(NAME, input.name, 'has too many rules');
      pageCount += 1;
      if (Array.isArray(page.incomplete)) incomplete += page.incomplete.length;
      const label = pageLabel(page.url, sink);
      for (const v of page.violations) {
        if (!isObject(v) || typeof v.id !== 'string' || !RULE_ID.test(v.id)) throw new AdapterError(NAME, input.name, 'has a violation without a valid rule id');
        const nodes = Array.isArray(v.nodes) ? v.nodes : [];
        const tags = Array.isArray(v.tags) ? v.tags.slice(0, 40) : [];
        const { level, criterion } = wcagFromTags(tags);
        failing.set(v.id, true);
        const selectors = nodes.slice(0, 5).map((n) => (isObject(n) && Array.isArray(n.target) ? safeText(n.target.map(String).join(' '), 80, sink) : '')).filter(Boolean);
        const wcagBlocker = level === 'A' || level === 'AA';
        const impact = typeof v.impact === 'string' ? v.impact : 'unknown';
        findings.push({
          source_id: v.id,
          severity: wcagBlocker ? 'blocker' : impact === 'critical' || impact === 'serious' ? 'major' : 'minor',
          dimension: 'accessibility_inclusion',
          check_id: 'd8.axe_violations',
          message: `axe rule ${v.id}: ${safeText(v.help ?? v.description ?? '', 200, sink)}`.trim(),
          fix_hint: `${safeText(v.help ?? 'See the axe rule.', 200, sink)} Affected (${nodes.length} element${nodes.length === 1 ? '' : 's'}${nodes.length > selectors.length ? `, first ${selectors.length} shown` : ''}): ${selectors.join('; ') || 'no selector given'}.`.slice(0, TEXT_LIMITS.fixHint),
          location: { file: label },
          origin: `adapter:${NAME}`,
          ...(level && (level === 'A' || level === 'AA' || level === 'AAA') ? { kind: 'wcag_failure', wcag_level: level, ...(criterion ? { wcag_criterion: criterion } : {}) } : {}),
        });
      }
      for (const p of page.passes) {
        if (!isObject(p) || typeof p.id !== 'string' || !RULE_ID.test(p.id)) throw new AdapterError(NAME, input.name, 'has a pass without a valid rule id');
        passing.add(p.id);
      }
    }
  }
  for (const id of failing.keys()) passing.delete(id);
  const total = passing.size + failing.size;
  const evidence = [];
  if (total > 0) {
    evidence.push({
      check_id: 'd8.axe_violations',
      value: passing.size / total,
      detail: `${passing.size} of ${total} axe-core rules passing across ${pageCount} page(s); ${incomplete} incomplete (needs review) not counted.`,
      artifact_ref: sources.length === 1 ? sources[0] : `${sources[0]}+${sources.length - 1}`,
      origin: `adapter:${NAME}`,
    });
  }
  return { evidence, findings, notes: total === 0 ? ['axe: no passing or failing rules, so no evidence was produced'] : [] };
}
