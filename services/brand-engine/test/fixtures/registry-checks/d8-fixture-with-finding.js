// FIXTURE check module for the registry tests. Not a real check.
import { helper } from './_lib/helper.js';
export default {
  id: 'd8.fixture_with_finding',
  dimension: 'accessibility_inclusion',
  title: 'Fixture d8.fixture_with_finding',
  appliesTo: () => true,
  run: (ctx) => ({ status: 'measured', evidence: [{ check_id: 'd8.fixture_with_finding', source_class: 'automated_check', result: 0.5 }], findings: [{ id: 'f-1', severity: 'blocker', dimension: 'accessibility_inclusion', check_id: 'd8.fixture_with_finding', message: 'Fixture finding', location: { file: 'index.html', line: 3 }, fix_hint: 'Fix it.' }] }),
};
void helper;
