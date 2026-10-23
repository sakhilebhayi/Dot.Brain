import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MIN_SAMPLE, gradeOutcomes } from '../src/grade.js';

const rows = (version, adopted, declined) => [
  ...Array.from({ length: adopted }, (_, i) => ({ decision_event_id: `kc:m${i}a:${version}:d`, outcome: 'adopted', decided_at: '2026-01-01T00:00:00Z' })),
  ...Array.from({ length: declined }, (_, i) => ({ decision_event_id: `kc:m${i}d:${version}:d`, outcome: 'declined', decided_at: '2026-01-01T00:00:00Z' })),
];

test('hit-rate is adopted / (adopted + declined) with its sample size once there is enough data', () => {
  const g = gradeOutcomes([], rows('v1', 9, 3));
  assert.deepEqual(g.by_rule_version.v1, { adopted: 9, declined: 3, sample: 12, min_sample: 10, status: 'ok', hit_rate: 0.75 });
});

test('below the minimum sample the answer is "insufficient data", never a number', () => {
  const g = gradeOutcomes([], rows('v1', 4, 1));
  assert.equal(g.by_rule_version.v1.status, 'insufficient data');
  assert.equal(g.by_rule_version.v1.hit_rate, null);
  assert.equal(g.by_rule_version.v1.sample, 5);
});

test('the boundary: 9 is insufficient, 10 is graded; the minimum is configurable', () => {
  assert.equal(DEFAULT_MIN_SAMPLE, 10);
  assert.equal(gradeOutcomes([], rows('v', 5, 4)).by_rule_version.v.hit_rate, null);
  assert.equal(gradeOutcomes([], rows('v', 5, 5)).by_rule_version.v.hit_rate, 0.5);
  assert.equal(gradeOutcomes([], rows('v', 2, 1), { minSample: 3 }).by_rule_version.v.hit_rate, 0.667);
});

test('versions are graded separately and listed in order', () => {
  const g = gradeOutcomes([], [...rows('b', 10, 0), ...rows('a', 1, 1)]);
  assert.deepEqual(Object.keys(g.by_rule_version), ['a', 'b']);
  assert.equal(g.by_rule_version.b.hit_rate, 1);
  assert.equal(g.by_rule_version.a.hit_rate, null);
});

test('rule_version comes from the known decisions first, else from the event id', () => {
  const g = gradeOutcomes(
    [{ event_id: 'opaque-id', rule_version: 'from-decisions' }],
    [{ decision_event_id: 'opaque-id', outcome: 'adopted' }, { decision_event_id: 'kc:m:parsed:d', outcome: 'declined' }],
  );
  assert.deepEqual(Object.keys(g.by_rule_version), ['from-decisions', 'parsed']);
});

test('an outcome whose decision cannot be placed is counted as ungradable, not guessed', () => {
  const g = gradeOutcomes([], [{ decision_event_id: 'who-knows', outcome: 'adopted' }]);
  assert.equal(g.ungradable, 1);
  assert.deepEqual(g.by_rule_version, {});
});

test('one outcome per decision: the latest decided_at wins, duplicates do not inflate the sample', () => {
  const id = 'kc:m:v:d';
  const g = gradeOutcomes([], [
    { decision_event_id: id, outcome: 'declined', decided_at: '2026-01-01T00:00:00Z' },
    { decision_event_id: id, outcome: 'adopted', decided_at: '2026-02-01T00:00:00Z' },
    { decision_event_id: id, outcome: 'declined', decided_at: '2025-12-01T00:00:00Z' },
  ], { minSample: 1 });
  assert.deepEqual([g.by_rule_version.v.adopted, g.by_rule_version.v.declined], [1, 0]);
});

test('unknown outcome values and empty input are ignored safely', () => {
  assert.deepEqual(gradeOutcomes(undefined, undefined), { by_rule_version: {}, ungradable: 0 });
  assert.deepEqual(gradeOutcomes([], [{ decision_event_id: 'kc:m:v:d', outcome: 'maybe' }, null]), { by_rule_version: {}, ungradable: 0 });
});
