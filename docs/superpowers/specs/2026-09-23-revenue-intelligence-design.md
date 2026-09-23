# Revenue Intelligence Module

## Context

Dot.Brains' stated purpose for this module: analyze data across the ecosystem to find "opportunities for improvement... to generate more revenue" and "proactively deliver insights to registered admin users." Two pieces of infrastructure already exist to build this on, both shipped this session:

- **`services/revenue-reader`** (ADR-0018) polls an enrolled platform's `dot-revenue/v1` endpoint and returns `{ok: true, platform, generated_at, classification, signals}` — pre-aggregated business signals, never raw records, never persisted.
- **`services/insight-delivery`** (ADR-0017) classifies a finding as an Insight, runs it through Ethics/Security gates, records gate-cleared Insights to Dot.Memory, and delivers push via Dot.Notify's existing channel/consent/precision-gating.

Revenue Intelligence's actual new work is narrower than it first sounds: **the opportunity-detection heuristics themselves.** Everything downstream of "here is a candidate finding" — gating, recording, delivery — already exists and should be reused in shape, not reinvented. This is a normal consumer of the two boundaries ADR-0017 and ADR-0018 already approved; it introduces no new trust boundary and needs no new ADR.

One targeting question resolves cleanly from existing infrastructure: "proactively deliver to registered admin users" sounds like it needs new per-user delivery plumbing, but Dot.Notify's own data model is already per-**recipient** ("Channel registration | recipient + channel | Consent state lives here," `dot-notify.md` §2), not per-platform. Revenue Intelligence's `deliverInsight()` always passes a delivery-time `audience: 'admin'` parameter to Notify — deliberately *not* the Insight's own `scope` field, since `insight.schema.json` defines `scope` as "where the insight applies (site, tenant, global)," a different concept the two happen to share a tempting name with. Notify's existing consent/role resolution — the same mechanism every other platform's alerts already use — decides who `audience: 'admin'` reaches. No new delivery infrastructure, no new admin-user registry.

## Goal

Ship `services/revenue-intelligence`, following the exact conventions of every sibling service (ES modules, `node --test`, injectable `fetch`/env, self-contained — no cross-service imports):

1. `opportunities.js` — pure heuristic detection over a revenue-reader poll result, producing zero or more `insight.schema.json`-shaped candidates.
2. `gates.js`, `memory-client.js`, `deliver.js` — the same shape as `services/insight-delivery`'s files of the same name, duplicated per this repo's established convention (every service owns its own small clients rather than importing a sibling's), with delivery always addressed to the `admin` audience.
3. `pipeline.js` — orchestrates detection → gate → record → deliver for one poll result.
4. A CLI and doc updates recording the new component.

## Non-goals

- No platform enrollment (still none exist — Revenue Reader's Non-goals carry forward).
- No new ADR — this introduces no new trust boundary, only consumes the two already approved.
- No scheduling/orchestration layer that calls `revenue-reader poll` and feeds its output into this module automatically — that composition is documented, not built, since there is no enrolled platform yet to schedule against.
- No new Notify targeting mechanism — the delivery-time `audience: 'admin'` parameter reuses Notify's existing per-recipient consent/role resolution unchanged.

## 1. Opportunity detection

`detectOpportunities(pollResult)` takes exactly Revenue Reader's success shape (`{platform, generated_at, classification, signals}`) and returns an array of Insight candidates (`{statement, domain: 'revenue', method, evidence, scope: <platform>, 'x-classification': classification, valid_until}`). `scope` is the enrolling platform (insight.schema.json's own meaning: where the insight applies); `classification` is carried as `x-classification` since `insight.schema.json` is `additionalProperties: false` and only extends via the `^x-` pattern. Three concrete v1 heuristics, each independently testable and each producing at most one insight per matching signal:

| Heuristic | Trigger | `statement` |
|---|---|---|
| MRR decline | a `revenue.mrr` signal with `trend === 'down'` | "MRR is trending down for `<platform>`." |
| High churn | a `revenue.churn_rate` signal with `value > 0.05` | "Churn rate (`<value>`) exceeds the 5% watch threshold for `<platform>`." |
| Payout delay anomaly | a `finance.payout_delay_p50` signal with `trend === 'up'` | "Payout delay is trending up for `<platform>` — an operational risk to revenue." |

Each generated insight's `evidence` is a single entry of kind `external` (ADR-0018 Decision 4: evidence sourced from a live Revenue Reader poll, as opposed to `metric`, which is for evidence already resident in Brain's own metric registry), referencing the triggering signal's `key` and the poll's `platform`/`generated_at` — never the full raw signals array, keeping the same evidence-not-raw-data discipline as every other Insight in this system. `x-classification` on the generated insight is inherited from the poll result's own `classification` (never upgraded, never invented). A signal that matches no heuristic produces nothing — silence, not a low-confidence guess.

## 2. Downstream reuse (gates, record, deliver)

`gates.js`, `memory-client.js`, and `deliver.js` are the same shape and behavior as `services/insight-delivery`'s files of the same name — same prohibited-metrics list, same `{ok, reason}` / `{available, reason}` honest-degradation convention, same intelligence-loop envelope for push delivery, with `runSecurityGate` reading `x-classification` rather than a plain `classification` field. The only difference: `deliverInsight()` always passes `audience: 'admin'` to Notify. This is duplication by design, matching every other service in this repo (`guardian`, `blupin-context`, `insight-delivery` each own their own small clients rather than importing a sibling's) — not an oversight to fix later.

## 3. Pipeline

`runPipeline({pollResult, cfg, notifyClient, targetPlatformClearance})`:

1. `detectOpportunities(pollResult)` → candidate insights.
2. For each candidate: `runEthicsGate` then `runSecurityGate(insight, targetPlatformClearance)`. A rejection is collected, not thrown — one bad candidate never blocks the others.
3. Each gate-cleared candidate: `recordInsight` (pull-queryable immediately, same as Insight Delivery), then `deliverInsight` with `audience: 'admin'` (push, routed through Notify).
4. Returns `{delivered: [...], rejected: [...]}` — every candidate accounted for, nothing silently dropped.

## Error handling

- A malformed, missing, or non-array `signals` (or a non-object entry within it), or a missing/wrong-typed/unparseable/out-of-range `generated_at`, produces zero candidates, not an error — `detectOpportunities` never throws. This holds regardless of caller: the CLI's `detect` command feeds it arbitrary, unvalidated JSON read from a file, not only revenue-reader's own validated poll results.
- Gate rejection, Dot.Memory unavailability, and Notify delivery failure all follow the exact same handling already established in `services/insight-delivery` (never thrown, always returned as a structured result the caller can act on).

## Testing

- `opportunities.js`: one test per heuristic's trigger and non-trigger case, plus a test that an empty/no-match signals array yields zero candidates — pure functions, no network.
- `gates.js`, `memory-client.js`, `deliver.js`: same test shape as `services/insight-delivery`'s existing suites for the same-named files (injectable `fetch`, no real network).
- `pipeline.js`: an integration-style test per outcome (gate-cleared and delivered; gate-rejected and never delivered), using injectable fakes throughout.

## Open questions

- Whether the three v1 heuristics' thresholds (5% churn, MRR trend, payout-delay trend) should be configurable per platform rather than hardcoded — deferred until a real platform enrolls and the thresholds can be validated against real data.
- Whether `runPipeline` should be invoked on a schedule once a platform enrolls, and by what mechanism — explicitly out of scope here (Non-goals).

## Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-09-23 | Continuation session | Initial design. |
| 1.0.1 | 2026-09-23 | Post-merge repeat-check | Corrected throughout: delivery targeting is `audience: 'admin'` (a Notify-call parameter), not the Insight's own `scope` field (which is the enrolling platform, per insight.schema.json's actual meaning); `classification` is carried as `x-classification` (the schema is `additionalProperties: false`); evidence `kind` is `external` per ADR-0018 Decision 4, not `metric`. The implementation shipped with these three defects; caught and fixed in the same session before any consumer depended on the wrong shape. |
| 1.0.2 | 2026-09-23 | Post-merge repeat-check, round 2 | Corrected Error handling: `detectOpportunities`'s "never throws" guarantee did not actually hold for a non-array/missing `signals`, a null entry within it, a `null`/numeric `generated_at`, or a `generated_at` close enough to Date's representable limit that `valid_until`'s `+24h` computation overflowed — all four crashed in practice (a `TypeError` or `RangeError`), reachable via the CLI on an arbitrary input file. Fixed with explicit guards; the guarantee now actually holds. |
