// FIXTURE check module for the registry tests. Not a real check.
import { helper } from './_lib/helper.js';
export default {
  id: 'd8.fixture_throw',
  dimension: 'accessibility_inclusion',
  title: 'Fixture d8.fixture_throw',
  appliesTo: () => true,
  run: () => { throw new Error(`boom at /secret/place s${'k'}-${'a1B2'.repeat(6)}`); },
};
void helper;
