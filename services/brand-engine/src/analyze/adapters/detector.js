// services/brand-engine/src/analyze/adapters/detector.js
//
// The design detector (`impeccable detect --json [target]`).
//
// FORMAT (learned from a real run of the installed detector, version 0.1.11,
// on a synthetic page; the engine never runs it): a JSON array, one object per
// hit, an empty array when clean:
//   { antipattern: "overused-font", name, description, severity: "warning",
//     category: "slop" | "quality", file: "<absolute path>", line: 0, snippet }
// The same hit can appear more than once; hits are de-duplicated on
// (antipattern, file, line, snippet). `line` is 0 when the detector has no
// line (HTML it analysed statically).
//
// ROUTING. The rubric splits detector findings between two checks so that no
// finding scores twice:
//   d2.impeccable_detect_findings  identity: typography, colour, layout
//                                  templates (category "slop", except motion)
//   d4.detector_clean              detail: everything else (category "quality"
//                                  and the motion rules), contrast hits included
// value = max(0, 1 - n / ceiling), n = distinct counted hits, ceiling 10 (the
// "configured ceiling" of the rubric; DETECTOR_CEILING). Hits with severity
// "advisory" or "info" are listed as info findings and never counted.
// A hit with an unknown category is counted in d4 (it is not an identity rule
// the rubric names), and the count of such hits is stated in the evidence detail.
import { DETECTOR_CEILING, REPORT_LIMITS, TEXT_LIMITS } from '../limits.js';
import { DIMENSION_BY_ORDER } from '../tables.js';
import { safeText } from '../text.js';
import { AdapterError, isObject, parseJson, refName, relativeTo } from './common.js';

export const NAME = 'detector';
export const PRIORITY = 10;
export const PRODUCES = ['d2.impeccable_detect_findings', 'd4.detector_clean'];

const MOTION_RULES = new Set(['bounce-easing', 'animate-bounce']);
const IDENTITY_CATEGORIES = new Set(['slop']);
const KNOWN_CATEGORIES = new Set(['slop', 'quality']);
const ANTIPATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

export const matchesName = (name) => /(?:detect|impeccable)[^/]*\.json$/i.test(name);
export const sniff = (value) => Array.isArray(value) && value.length > 0 && isObject(value[0]) && typeof value[0].antipattern === 'string';

function check(entry) {
  if (MOTION_RULES.has(entry.antipattern)) return 'd4.detector_clean';
  return IDENTITY_CATEGORIES.has(entry.category) ? 'd2.impeccable_detect_findings' : 'd4.detector_clean';
}

export function ingest(inputs, { root, sink, ceiling = DETECTOR_CEILING }) {
  const hits = new Map();
  const sources = [];
  for (const input of inputs) {
    const list = parseJson(NAME, input.name, input.text);
    if (!Array.isArray(list)) throw new AdapterError(NAME, input.name, 'must be a JSON array of findings');
    if (list.length > REPORT_LIMITS.maxFindings) throw new AdapterError(NAME, input.name, `has more than ${REPORT_LIMITS.maxFindings} findings`);
    sources.push(refName(input.name));
    list.forEach((e, i) => {
      if (!isObject(e)) throw new AdapterError(NAME, input.name, `entry ${i} is not an object`);
      if (typeof e.antipattern !== 'string' || !ANTIPATTERN.test(e.antipattern)) throw new AdapterError(NAME, input.name, `entry ${i} has no valid antipattern id`);
      if (typeof e.file !== 'string' || e.file === '') throw new AdapterError(NAME, input.name, `entry ${i} has no file`);
      if (e.line !== undefined && !(Number.isInteger(e.line) && e.line >= 0 && e.line < 1e7)) throw new AdapterError(NAME, input.name, `entry ${i} has an invalid line`);
      if (e.severity !== undefined && typeof e.severity !== 'string') throw new AdapterError(NAME, input.name, `entry ${i} has an invalid severity`);
      if (e.category !== undefined && typeof e.category !== 'string') throw new AdapterError(NAME, input.name, `entry ${i} has an invalid category`);
      const file = relativeTo(root, e.file, sink);
      const line = e.line > 0 ? e.line : undefined;
      const snippet = safeText(e.snippet ?? '', 200, sink);
      const key = `${e.antipattern}|${file}|${line ?? 0}|${snippet}`;
      if (hits.has(key)) return;
      hits.set(key, {
        antipattern: e.antipattern,
        category: typeof e.category === 'string' ? e.category : 'unknown',
        severity: typeof e.severity === 'string' ? e.severity : 'warning',
        name: safeText(e.name ?? e.antipattern, 120, sink),
        file, line, snippet,
        description: safeText(e.description ?? '', TEXT_LIMITS.fixHint, sink),
      });
    });
  }

  const counted = { 'd2.impeccable_detect_findings': 0, 'd4.detector_clean': 0 };
  const findings = [];
  let unknownCategory = 0;
  for (const h of [...hits.values()].sort((a, b) => (`${a.file}|${a.line ?? 0}|${a.antipattern}|${a.snippet}` < `${b.file}|${b.line ?? 0}|${b.antipattern}|${b.snippet}` ? -1 : 1))) {
    const advisory = h.severity === 'advisory' || h.severity === 'info';
    const checkId = check(h);
    if (!advisory) {
      counted[checkId] += 1;
      if (!KNOWN_CATEGORIES.has(h.category)) unknownCategory += 1;
    }
    const dimension = DIMENSION_BY_ORDER[checkId === 'd2.impeccable_detect_findings' ? 2 : 4];
    findings.push({
      source_id: `${h.antipattern}`,
      severity: advisory ? 'info' : h.severity === 'error' ? 'major' : 'minor',
      dimension,
      check_id: checkId,
      message: `Design detector rule ${h.antipattern}: ${h.name}${h.snippet ? ` (${h.snippet})` : ''}`.slice(0, TEXT_LIMITS.message),
      fix_hint: h.description || 'See the detector rule description.',
      location: { file: h.file, ...(h.line ? { line: h.line } : {}) },
      origin: `adapter:${NAME}`,
    });
  }

  const ref = sources.length === 1 ? sources[0] : `${sources[0]}+${sources.length - 1}`;
  const evidence = Object.entries(counted).map(([check_id, n]) => ({
    check_id,
    value: Math.max(0, 1 - n / ceiling),
    detail: `${n} distinct detector finding(s) counted against a ceiling of ${ceiling}; advisory hits are listed and not counted${check_id === 'd4.detector_clean' && unknownCategory ? `; ${unknownCategory} hit(s) had a category the rubric does not name and were counted here` : ''}.`,
    artifact_ref: ref,
    origin: `adapter:${NAME}`,
  }));
  return { evidence, findings, notes: [] };
}
