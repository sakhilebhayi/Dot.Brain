// services/brand-engine/src/analyze/adapters/tests.js
//
// JUnit XML and TAP together: test RESULTS, pooled across every file supplied.
//
//   d5.test_pass_counts  value = passed / (passed + failed). Skipped and TODO
//        tests are not counted either way and are stated in the detail. No
//        test executed means no evidence (an empty run is not a pass).
//   d10.error_path_tests value = passed / (passed + failed) over the tests
//        TAGGED as error paths: a name containing "[error-path]" or
//        "@error-path" (case-insensitive). The rubric measures "declared error
//        paths covered by a passing test"; the tag is how a product declares
//        them. No tagged test means no evidence.
//   Each failed test is a finding of severity "blocker", kind failing_test:
//        the rubric makes a failing test in scope a blocker.
import { DIMENSION_BY_ORDER } from '../tables.js';
import { relativeTo, refName } from './common.js';
import { parseJunit, sniff as sniffJunit } from './junit.js';
import { parseTap, sniff as sniffTap } from './tap.js';

export const NAME = 'tests';
export const PRIORITY = 10;
export const PRODUCES = ['d5.test_pass_counts', 'd10.error_path_tests'];

export const matchesName = (name) => /(?:junit|xunit)[^/]*\.xml$/i.test(name) || /\.tap$/i.test(name);
export const sniff = (text) => sniffJunit(text) || sniffTap(text);

const ERROR_PATH = /[[@]error-path\]?/i;

function pooled(tests) {
  const passed = tests.filter((t) => t.status === 'passed').length;
  const failed = tests.filter((t) => t.status === 'failed').length;
  const skipped = tests.filter((t) => t.status === 'skipped').length;
  return { passed, failed, skipped, ran: passed + failed };
}

export function ingest(inputs, { root, sink }) {
  const tests = [];
  const sources = [];
  for (const input of inputs) {
    sources.push(refName(input.name));
    const parsed = /^\s*</.test(input.text) ? parseJunit(input.name, input.text, sink) : parseTap(input.name, input.text, sink);
    for (const t of parsed) tests.push({ ...t, source: input.name });
  }
  const ref = sources.length === 1 ? sources[0] : `${sources[0]}+${sources.length - 1}`;
  const evidence = [];
  const notes = [];

  const all = pooled(tests);
  if (all.ran > 0) {
    evidence.push({
      check_id: 'd5.test_pass_counts', value: all.passed / all.ran,
      detail: `${all.passed} passed, ${all.failed} failed, ${all.skipped} skipped of ${tests.length} test(s) in ${inputs.length} report(s); skipped tests are not counted.`,
      artifact_ref: ref, origin: `adapter:${NAME}`,
    });
  } else notes.push('tests: no test executed in the supplied reports, so no evidence was produced');

  const tagged = tests.filter((t) => ERROR_PATH.test(t.name));
  const e = pooled(tagged);
  if (e.ran > 0) {
    evidence.push({
      check_id: 'd10.error_path_tests', value: e.passed / e.ran,
      detail: `${e.passed} of ${e.ran} tests tagged "error-path" pass (${e.skipped} skipped, not counted); untagged tests are not error-path evidence.`,
      artifact_ref: ref, origin: `adapter:${NAME}`,
    });
  }

  // One finding per failed test, on d5.test_pass_counts (a failed error-path
  // test also lowers d10.error_path_tests; fixing the test fixes both).
  const findings = [];
  for (const t of tests.filter((x) => x.status === 'failed')) {
    const location = t.file ? { file: relativeTo(root, t.file, sink) } : undefined;
    findings.push({
      source_id: 'failing-test',
      severity: 'blocker',
      dimension: DIMENSION_BY_ORDER[5],
      check_id: 'd5.test_pass_counts',
      message: `Test failed: ${t.name}`,
      fix_hint: 'Fix the behaviour the test covers (or the test, if it is wrong), re-run the suite and supply the new report.',
      kind: 'failing_test',
      ...(location && location.file !== '.' ? { location } : {}),
      origin: `adapter:${NAME}`,
    });
  }
  return { evidence, findings, notes };
}
