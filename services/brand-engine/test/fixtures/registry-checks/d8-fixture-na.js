// FIXTURE check module for the registry tests. Not a real check.
import { helper } from './_lib/helper.js';
export default {
  id: 'd8.fixture_na',
  dimension: 'accessibility_inclusion',
  title: 'Fixture d8.fixture_na',
  appliesTo: () => true,
  run: () => ({ status: 'not_applicable', evidence: [], findings: [] }),
};
void helper;
