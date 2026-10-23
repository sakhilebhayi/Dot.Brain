// FIXTURE check module for the registry tests. Not a real check.
import { helper } from './_lib/helper.js';
export default {
  id: 'd8.fixture_hang',
  dimension: 'accessibility_inclusion',
  title: 'Fixture d8.fixture_hang',
  appliesTo: () => true,
  run: () => new Promise(() => {}),
};
void helper;
