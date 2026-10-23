// FIXTURE check module for the registry tests. Not a real check.
import { helper } from './_lib/helper.js';
export default {
  id: 'd8.fixture_pass',
  dimension: 'accessibility_inclusion',
  title: 'Fixture d8.fixture_pass',
  appliesTo: () => true,
  run: (ctx) => ({ status: 'measured', evidence: [{ check_id: 'd8.fixture_pass', source_class: 'automated_check', result: 1, detail: 'themes: ' + ctx.themes.join(',') + '; files: ' + ctx.files.list('**/*.html').join(',') }], findings: [] }),
};
void helper;
