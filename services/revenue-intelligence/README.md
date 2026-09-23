# Dot.Brain — Revenue Intelligence

Opportunity-detection heuristics over a [Revenue Reader](../revenue-reader/README.md)
poll result (design spec:
[docs/superpowers/specs/2026-09-23-revenue-intelligence-design.md](../../docs/superpowers/specs/2026-09-23-revenue-intelligence-design.md)).

Feeds the same gate → record → Notify-routed-delivery pipeline shape as
[Insight Delivery](../insight-delivery/README.md) (ADR-0017), duplicated
here per this repo's established convention -- every service owns its
own small clients rather than importing a sibling's -- with delivery
always addressed to the `admin` audience. Notify's own per-recipient
consent/role resolution decides who that reaches; no new targeting
infrastructure exists here. `audience` is a delivery-time parameter
only, kept deliberately distinct from the Insight's own `scope` field
(`insight.schema.json`: "where the insight applies, site/tenant/global"
-- set here to the enrolling platform) -- the two are different
concepts that happen to share a tempting name.

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
   the full raw payload; its `scope` is the enrolling platform (the
   insight.schema.json-defined meaning: where the insight applies).
2. `runEthicsGate()` / `runSecurityGate()` — same as Insight Delivery's.
3. `recordInsight()` — gate-cleared insights are recorded to Dot.Memory.
4. `deliverInsight()` — push, routed through Dot.Notify, always
   addressed to `audience: 'admin'` (a delivery-time parameter, not the
   Insight's own `scope`).
5. `recordDeliveryOutcome()` — closes the loop from Notify's existing
   delivery event, same as Insight Delivery.

`runPipeline()` ties the first four together for one poll result; every
candidate ends up in either `delivered` or `rejected`, nothing silently
dropped. `recordDeliveryOutcome()` (step 5) is not part of that call --
it closes the loop later, from Dot.Notify's own separate delivery-outcome
event, the same way `services/insight-delivery` does it.

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
