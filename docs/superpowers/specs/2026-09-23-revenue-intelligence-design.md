# Revenue Intelligence Module

## Context

Dot.Brains' stated purpose for this module: analyze data across the ecosystem to find "opportunities for improvement... to generate more revenue" and "proactively deliver insights to registered admin users." Two pieces of infrastructure already exist to build this on, both shipped this session:

- **`services/revenue-reader`** (ADR-0018) polls an enrolled platform's `dot-revenue/v1` endpoint and returns `{ok: true, platform, generated_at, classification, signals}` — pre-aggregated business signals, never raw records, never persisted.
- **`services/insight-delivery`** (ADR-0017) classifies a finding as an Insight, runs it through Ethics/Security gates, records gate-cleared Insights to Dot.Memory, and delivers push via Dot.Notify's existing channel/consent/precision-gating.

Revenue Intelligence's actual new work is narrower than it first sounds: **the opportunity-detection heuristics themselves.** Everything downstream of "here is a candidate finding" — gating, recording, delivery — already exists and should be reused in shape, not reinvented. This is a normal consumer of the two boundaries ADR-0017 and ADR-0018 already approved; it introduces no new trust boundary and needs no new ADR.

One targeting question resolves cleanly from existing infrastructure: "proactively deliver to registered admin users" sounds like it needs new per-user delivery plumbing, but Dot.Notify's own data model is already per-**recipient** ("Channel registration | recipient + channel | Consent state lives here," `dot-notify.md` §2), not per-platform. Insight Delivery's existing `deliverInsight()` already carries a `scope` field through to Notify unchanged; Revenue Intelligence simply always passes `scope: 'admin'`, and Notify's existing consent/role resolution — the same mechanism every other platform's alerts already use — decides who that reaches. No new delivery infrastructure, no new admin-user registry.

## Goal

Ship `services/revenue-intelligence`, following the exact conventions of every sibling service (ES modules, `node --test`, injectable `fetch`/env, self-contained — no cross-service imports):

1. `opportunities.js` — pure heuristic detection over a revenue-reader poll result, producing zero or more `insight.schema.json`-shaped candidates.
2. `gates.js`, `memory-client.js`, `deliver.js` — the same shape as `services/insight-delivery`'s files of the same name, duplicated per this repo's established convention (every service owns its own small clients rather than importing a sibling's), with delivery always scoped `admin`.
3. `pipeline.js` — orchestrates detection → gate → record → deliver for one poll result.
4. A CLI and doc updates recording the new component.

## Non-goals

- No platform enrollment (still none exist — Revenue Reader's Non-goals carry forward).
- No new ADR — this introduces no new trust boundary, only consumes the two already approved.
- No scheduling/orchestration layer that calls `revenue-reader poll` and feeds its output into this module automatically — that composition is documented, not built, since there is no enrolled platform yet to schedule against.
- No new Notify targeting mechanism — `scope: 'admin'` reuses Notify's existing per-recipient consent/role resolution unchanged.

## 1. Opportunity detection

`detectOpportunities(pollResult)` takes exactly Revenue Reader's success shape (`{platform, generated_at, classification, signals}`) and returns an array of Insight candidates (`{statement, domain: 'revenue', method, evidence, scope: 'admin', classification, valid_until}`). Three concrete v1 heuristics, each independently testable and each producing at most one insight per matching signal:

| Heuristic | Trigger | `statement` |
|---|---|---|
| MRR decline | a `revenue.mrr` signal with `trend === 'down'` | "MRR is trending down for `<platform>`." |
| High churn | a `revenue.churn_rate` signal with `value > 0.05` | "Churn rate (`<value>`) exceeds the 5% watch threshold for `<platform>`." |
| Payout delay anomaly | a `finance.payout_delay_p50` signal with `trend === 'up'` | "Payout delay is trending up for `<platform>` — an operational risk to revenue." |

Each generated insight's `evidence` is a single entry of kind `metric`, referencing the triggering signal's `key` and the poll's `platform`/`generated_at` — never the full raw signals array, keeping the same evidence-not-raw-data discipline as every other Insight in this system. `classification` on the generated insight is inherited from the poll result's own `classification` (never upgraded, never invented). A signal that matches no heuristic produces nothing — silence, not a low-confidence guess.

## 2. Downstream reuse (gates, record, deliver)

`gates.js`, `memory-client.js`, and `deliver.js` are the same shape and behavior as `services/insight-delivery`'s files of the same name — same prohibited-metrics list, same `{ok, reason}` / `{available, reason}` honest-degradation convention, same intelligence-loop envelope for push delivery. The only difference: `deliverInsight()` is always called with `scope: 'admin'`. This is duplication by design, matching every other service in this repo (`guardian`, `blupin-context`, `insight-delivery` each own their own small clients rather than importing a sibling's) — not an oversight to fix later.

## 3. Pipeline

`runPipeline({pollResult, cfg, notifyClient, targetPlatformClearance})`:

1. `detectOpportunities(pollResult)` → candidate insights.
2. For each candidate: `runEthicsGate` then `runSecurityGate(insight, targetPlatformClearance)`. A rejection is collected, not thrown — one bad candidate never blocks the others.
3. Each gate-cleared candidate: `recordInsight` (pull-queryable immediately, same as Insight Delivery), then `deliverInsight` with `scope: 'admin'` (push, routed through Notify).
4. Returns `{delivered: [...], rejected: [...]}` — every candidate accounted for, nothing silently dropped.

## Error handling

- A malformed or empty `signals` array produces zero candidates, not an error — `detectOpportunities` never throws on well-formed-but-boring input.
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
