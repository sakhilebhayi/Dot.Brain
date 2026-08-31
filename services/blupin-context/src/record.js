// One observation per trading day, idempotent on event_id, joined to the
// BluPin loop by loop_id/subject so GET /api/intelligence/context for
// trading-signal/gold-<date> returns the signal AND its news backdrop.

export function buildContextRecord(sastDate, events, now = new Date()) {
  return {
    loop_id: `blupin-gold-${sastDate}`,
    event_id: `blupin-gold-${sastDate}-news`,
    platform: 'dot-brain',
    source: 'blupin-context-service',
    subject_type: 'trading-signal',
    subject_id: `gold-${sastDate}`,
    subject_label: 'BluPin ORD+ULT daily signal (TVC:GOLD)',
    occurred_at: now.toISOString(),
    signature: 'usd-news-calendar',
    detail: {
      feed: 'forexfactory-thisweek',
      count: events.length,
      events,
    },
  };
}
