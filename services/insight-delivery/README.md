# Dot.Brain — Insight Delivery

Dot.Brain's outbound Insight path (design spec:
[docs/superpowers/specs/2026-09-19-outbound-insight-delivery-design.md](../../docs/superpowers/specs/2026-09-19-outbound-insight-delivery-design.md),
ADR: [ADR-0017](../../adr/ADR-0017-outbound-insight-delivery.md)).

A second outbound path alongside the PR Generator: a gate-cleared,
non-structural finding delivered to platforms either by pull (queried
directly from Dot.Memory) or by push, routed entirely through Dot.Notify
via the ADR-0015 intelligence-loop envelope.

## Pipeline

1. `classifyConclusion()` — a W3 conclusion that implies no platform
   file/config change becomes an Insight candidate. Ambiguous always
   defaults to Recommendation.
2. `runEthicsGate()` / `runSecurityGate()` — the same two gates
   Recommendations pass through. Governance is never invoked for an
   Insight: nothing is being applied, so there is no decision-rights
   question.
3. `recordInsight()` / `searchInsights()` / `getInsight()` — gate-cleared
   Insights are recorded to Dot.Memory and queryable immediately (the pull
   surface).
4. `deliverInsight()` — for push, emits an intelligence-loop `action`
   envelope with `executor_platform: "dot-notify"` and hands the actual
   send to an injected `notifyClient`. Brain never chooses the channel,
   touches consent, or retries — that's entirely Notify's job.
5. `recordDeliveryOutcome()` — closes the loop from Notify's existing
   `messaging.delivery.acted/ignored` event.

## Environment

```
DOT_MEMORY_URL=https://memory.infodot.co.za
DOT_MEMORY_TOKEN=…
```

## Tests

```bash
npm test
```
