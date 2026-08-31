import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterHighImpactUsd, sastDateOf } from '../src/calendar.js';

const rows = [
  { title: 'Non-Farm Employment Change', country: 'USD', impact: 'High',
    date: '2026-09-04T08:30:00-04:00', forecast: '110K', previous: '73K' },
  { title: 'CPI y/y', country: 'USD', impact: 'High', date: '2026-09-04T22:30:00-04:00' },
  { title: 'German Ifo', country: 'EUR', impact: 'High', date: '2026-09-04T04:00:00-04:00' },
  { title: 'Crude Oil Inventories', country: 'USD', impact: 'Medium', date: '2026-09-04T10:30:00-04:00' },
];

test('sast date conversion crosses midnight correctly', () => {
  // 22:30 New York on the 4th is 04:30 SAST on the 5th
  assert.equal(sastDateOf('2026-09-04T22:30:00-04:00'), '2026-09-05');
  assert.equal(sastDateOf('2026-09-04T08:30:00-04:00'), '2026-09-04');
  assert.equal(sastDateOf('not a date'), null);
});

test('keeps only high-impact USD events on the SAST day', () => {
  const got = filterHighImpactUsd(rows, '2026-09-04');
  assert.equal(got.length, 1);
  assert.equal(got[0].title, 'Non-Farm Employment Change');
  assert.equal(got[0].forecast, '110K');
});

test('an evening US event lands on the next SAST day', () => {
  const got = filterHighImpactUsd(rows, '2026-09-05');
  assert.equal(got.length, 1);
  assert.equal(got[0].title, 'CPI y/y');
});

test('tolerates a non-array feed', () => {
  assert.deepEqual(filterHighImpactUsd(null, '2026-09-04'), []);
});
