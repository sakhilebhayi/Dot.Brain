#!/usr/bin/env node
// Usage: node src/cli.js [--dry-run] [--date YYYY-MM-DD]
// Records today's (SAST) scheduled high-impact USD news for the BluPin loop.
import { fetchCalendar, filterHighImpactUsd } from './calendar.js';
import { buildContextRecord } from './record.js';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const dateArg = args.includes('--date') ? args[args.indexOf('--date') + 1] : null;

const sastNow = new Date(Date.now() + 2 * 3600 * 1000);
const day = dateArg ?? sastNow.toISOString().slice(0, 10);

const rows = await fetchCalendar();
const events = filterHighImpactUsd(rows, day);
const record = buildContextRecord(day, events);
console.log(`context ${day}: ${events.length} high-impact USD event(s)` +
  (events.length ? ` — ${events.map(e => e.title).join('; ')}` : ''));

if (dry) {
  console.log(JSON.stringify(record, null, 2));
  process.exit(0);
}

const base = (process.env.DOT_MEMORY_URL ?? '').replace(/\/$/, '');
const token = process.env.DOT_MEMORY_TOKEN ?? '';
if (!base || !token) {
  console.error('DOT_MEMORY_URL / DOT_MEMORY_TOKEN not set');
  process.exit(1);
}
const post = await fetch(`${base}/api/intelligence/events`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  body: JSON.stringify(record),
});
console.log(`memory observation: HTTP ${post.status}`);
if (!post.ok) {
  console.error(await post.text());
  process.exit(1);
}

// Link proof: the aggregated context for this subject now holds both the
// signal records (platform blupin) and this news backdrop (dot-brain).
const ctx = await fetch(
  `${base}/api/intelligence/context?subject_type=trading-signal&subject_id=gold-${day}`,
  { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
console.log(`context read-back: HTTP ${ctx.status}`);
if (ctx.ok) {
  const body = await ctx.json();
  console.log(JSON.stringify(body).slice(0, 600));
}
