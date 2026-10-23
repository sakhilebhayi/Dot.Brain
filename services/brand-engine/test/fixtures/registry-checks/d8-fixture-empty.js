// FIXTURE check module for the registry tests. Not a real check.
import { helper } from './_lib/helper.js';
export default {
  id: 'd8.fixture_empty',
  dimension: 'accessibility_inclusion',
  title: 'Fixture d8.fixture_empty',
  appliesTo: () => true,
  run: () => ({ status: 'measured', evidence: [], findings: [] }),
};
void helper;
