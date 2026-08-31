// The ForexFactory weekly calendar feed (free, no key):
//   https://nfs.faireconomy.media/ff_calendar_thisweek.json
// rows: { title, country, date (ISO with offset), impact, forecast, previous }
//
// BluPin's research found the damage concentrates in high-impact USD events
// (NFP went 1-for-24 over two years), so that is the class recorded here.

export const FEED_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000; // Africa/Johannesburg, no DST

// The SAST calendar date (YYYY-MM-DD) an ISO timestamp falls on.
export function sastDateOf(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return new Date(t.getTime() + SAST_OFFSET_MS).toISOString().slice(0, 10);
}

// High-impact USD events falling on the given SAST trading day.
export function filterHighImpactUsd(rows, sastDate) {
  return (Array.isArray(rows) ? rows : [])
    .filter(r => r && r.country === 'USD' && r.impact === 'High'
      && sastDateOf(r.date) === sastDate)
    .map(r => ({
      title: String(r.title ?? '').slice(0, 120),
      time_utc: new Date(r.date).toISOString(),
      forecast: r.forecast ?? null,
      previous: r.previous ?? null,
    }));
}

export async function fetchCalendar(fetchImpl = fetch) {
  const res = await fetchImpl(FEED_URL, { headers: { 'User-Agent': 'dot-brain-blupin-context' } });
  if (!res.ok) throw new Error(`calendar feed HTTP ${res.status}`);
  return res.json();
}
