// FIXTURE check module for the registry tests. Not a real check.
import { helper } from './_lib/helper.js';
export default {
  id: 'd8.fixture_escape',
  dimension: 'accessibility_inclusion',
  title: 'Fixture d8.fixture_escape',
  appliesTo: () => true,
  run: (ctx) => { ctx.files.read('../../../etc/passwd'); return { status: 'measured', evidence: [{ check_id: 'd8.fixture_escape', source_class: 'automated_check', result: 1 }], findings: [] }; },
};
void helper;
