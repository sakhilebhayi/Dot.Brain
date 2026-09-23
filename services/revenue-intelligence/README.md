# Dot.Brain — Revenue Intelligence

Opportunity-detection heuristics over a [Revenue Reader](../revenue-reader/README.md)
poll result (design spec:
[docs/superpowers/specs/2026-09-23-revenue-intelligence-design.md](../../docs/superpowers/specs/2026-09-23-revenue-intelligence-design.md)).

Feeds the same gate → record → Notify-routed-delivery pipeline shape as
[Insight Delivery](../insight-delivery/README.md) (ADR-0017), duplicated
here per this repo's established convention -- every service owns its
own small clients rather than importing a sibling's -- with delivery
always scoped to `admin` recipients. Notify's own per-recipient
consent/role resolution decides who that reaches; no new targeting
infrastructure exists here.

## No platform is enrolled yet

Like Revenue Reader (ADR-0018), this ships the generic capability only.
There is no scheduling layer that polls a platform and feeds its result
here automatically -- that composition is a future orchestration layer's
job, once a platform actually enrolls.

## Pipeline

1. `detectOpportunities()` — three v1 heuristics: MRR decline, high
   churn rate (>5%), and a rising payout-delay trend. An insight's
   `classification` always comes from the poll result itself, never
   invented; its `evidence` references only the triggering signal, not
   the full raw payload.
2. `runEthicsGate()` / `runSecurityGate()` — same as Insight Delivery's.
3. `recordInsight()` — gate-cleared insights are recorded to Dot.Memory.
4. `deliverInsight()` — push, routed through Dot.Notify, always
   `scope: 'admin'`.
5. `recordDeliveryOutcome()` — closes the loop from Notify's existing
   delivery event, same as Insight Delivery.

`runPipeline()` ties all five together for one poll result; every
candidate ends up in either `delivered` or `rejected`, nothing silently
dropped.

## CLI

Only `detect` is exposed — it is pure and always usable:

```bash
revenue-intelligence detect --signals-file signals.json
```

`runPipeline()`'s delivery step needs a real Dot.Notify client, which
doesn't exist yet (no platform is enrolled) -- it remains a library
function for a future orchestration layer to call directly, rather than
a CLI command that would always fail.

## Environment

```
DOT_MEMORY_URL=https://memory.infodot.co.za
DOT_MEMORY_TOKEN=…
```

## Tests

```bash
npm test
```
