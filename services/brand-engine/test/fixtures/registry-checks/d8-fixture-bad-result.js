// FIXTURE check module for the registry tests. Not a real check.
import { helper } from './_lib/helper.js';
export default {
  id: 'd8.fixture_bad_result',
  dimension: 'accessibility_inclusion',
  title: 'Fixture d8.fixture_bad_result',
  appliesTo: () => true,
  run: () => ({ status: 'ok', evidence: 'nope' }),
};
void helper;
