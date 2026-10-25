// services/brand-engine/src/analyze/adapters/tap.js
//
// TAP (Test Anything Protocol, versions 12 to 14; `node --test --test-reporter=tap`).
//
// Only TOP-LEVEL test points count (no indentation): a nested subtest is part
// of its parent's result. A point is "ok" or "not ok", an optional number, an
// optional "- description" and an optional directive:
//   "# SKIP" -> skipped,  "not ok ... # TODO" -> not a failure (counted as skipped).
// "Bail out!" is refused (the run did not finish). A "1..N" plan that does not
// match the points found is refused: a truncated report must not read as a pass.
// YAML diagnostic blocks ("---" to "...") and comments are ignored.
import { REPORT_LIMITS } from '../limits.js';
import { safeText } from '../text.js';
import { AdapterError } from './common.js';

export const matchesName = (name) => /\.tap$/i.test(name);
export const sniff = (text) => /^(?:TAP version \d+|1\.\.\d+)/m.test(text.slice(0, 4096));

const POINT = /^(not ok|ok)\b\s*(\d+)?\s*(?:-\s*)?(.*)$/;

export function parseTap(file, text, sink) {
  const tests = [];
  let plan = null;
  let inYaml = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (inYaml) { if (/^\s*\.\.\.\s*$/.test(line)) inYaml = false; continue; }
    if (/^\s+---\s*$/.test(line)) { inYaml = true; continue; }
    if (/^\s/.test(line)) continue; // nested subtest
    if (/^Bail out!/i.test(line)) throw new AdapterError('tap', file, 'reports "Bail out!": the run did not finish');
    const p = /^1\.\.(\d+)\s*(?:#.*)?$/.exec(line);
    if (p) { plan = Number(p[1]); continue; }
    const m = POINT.exec(line);
    if (!m) continue;
    let description = m[3];
    let directive = '';
    const hash = description.search(/\s#\s/);
    if (hash !== -1) { directive = description.slice(hash + 3).trim(); description = description.slice(0, hash); }
    const skip = /^skip\b/i.test(directive);
    const todo = /^todo\b/i.test(directive);
    tests.push({
      name: safeText(description || `test ${m[2] ?? tests.length + 1}`, 200, sink),
      status: skip || todo ? 'skipped' : m[1] === 'ok' ? 'passed' : 'failed',
    });
    if (tests.length > REPORT_LIMITS.maxTests) throw new AdapterError('tap', file, `has more than ${REPORT_LIMITS.maxTests} test points`);
  }
  if (tests.length === 0) throw new AdapterError('tap', file, 'has no test points');
  if (plan !== null && plan !== tests.length) throw new AdapterError('tap', file, `plans ${plan} test(s) but contains ${tests.length}: the report is incomplete`);
  return tests;
}
