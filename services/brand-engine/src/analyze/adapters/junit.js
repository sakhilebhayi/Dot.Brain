// services/brand-engine/src/analyze/adapters/junit.js
//
// JUnit XML (the "xUnit" report most test runners can write).
//
// FORMAT: <testsuites>? <testsuite name?> <testcase name classname? file? time?>
//   (<failure|error message?> | <skipped/>)? </testcase> </testsuite> </testsuites>
// Test cases are COUNTED from the <testcase> elements; the totals in the
// suite attributes are ignored because they are the first thing a broken
// reporter gets wrong. A testcase with a <failure> or <error> child failed,
// one with <skipped> was skipped, anything else passed.
import { REPORT_LIMITS } from '../limits.js';
import { safeText } from '../text.js';
import { AdapterError } from './common.js';
import { parseXml, XmlError } from './xml.js';

export const matchesName = (name) => /\.xml$/i.test(name);
export const sniff = (text) => /<testsuites?[\s>]/.test(text.slice(0, 4096));

/** -> [{name, file?, status: 'passed'|'failed'|'skipped'}] */
export function parseJunit(file, text, sink) {
  let root;
  try {
    root = parseXml(text);
  } catch (error) {
    if (error instanceof XmlError) throw new AdapterError('junit', file, `is not acceptable XML (${safeText(error.message, 120)})`);
    throw error;
  }
  if (root.name !== 'testsuites' && root.name !== 'testsuite') throw new AdapterError('junit', file, 'must have <testsuites> or <testsuite> as its root element');
  const tests = [];
  const visit = (node) => {
    if (node.name === 'testcase') {
      if (typeof node.attrs.name !== 'string' || node.attrs.name === '') throw new AdapterError('junit', file, 'has a <testcase> without a name');
      const childNames = node.children.map((c) => c.name);
      const failed = childNames.includes('failure') || childNames.includes('error');
      const skipped = !failed && childNames.includes('skipped');
      const cls = typeof node.attrs.classname === 'string' && node.attrs.classname ? `${node.attrs.classname} ` : '';
      tests.push({
        name: safeText(`${cls}${node.attrs.name}`, 200, sink),
        ...(typeof node.attrs.file === 'string' && node.attrs.file ? { file: node.attrs.file } : {}),
        status: failed ? 'failed' : skipped ? 'skipped' : 'passed',
      });
      if (tests.length > REPORT_LIMITS.maxTests) throw new AdapterError('junit', file, `has more than ${REPORT_LIMITS.maxTests} test cases`);
      return;
    }
    for (const c of node.children) visit(c);
  };
  visit(root);
  return tests;
}
