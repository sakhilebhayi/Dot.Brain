# Cross-Platform Read Access

## Context

Dot.Brains' Revenue Intelligence module (the sub-project this unblocks) needs data Brain does not have today: no platform publishes revenue-relevant Knowledge Packs, and Dot.Billing — the platform that owns settlement data — exposes nothing live at all; "settlement data currently leaves only via batched DKP packs" (`dot-billing.md:42-49`), with no read surface a consumer could query on demand. Waiting for every platform to redesign its DKP publishing schedule and schema around revenue-shaped signals is slower and less controllable than Brain being able to ask directly, so this design adds a new, Brain-initiated pull channel.

That is a real boundary change, not a detail. `CLAUDE.md` Rule 4 states Brain "ingests published Knowledge Packs and responds with Pull Requests" — a live-pull channel is a third mode that sentence does not describe. `brain.architecture.md`'s inbound trust boundary is explicit: "only signed DKPs through the Gateway; no direct graph writes from outside" (`brain.architecture.md:133`), and `brain.security.md`'s trust-zone model states platforms reach Brain "only via signed DKPs + read API" (`brain.security.md:30-47`) — today's docs describe zero Brain→platform pull path in either direction. This design carves out an explicit, narrow exception, not a reinterpretation.

The exception is not unprecedented in spirit. **Dot Guardian** (`adr/ADR-0014-dot-guardian-architecture.md`) is the one existing production capability where a Dot.Brain-owned service reaches out and reads live data from a platform, and its contract shape already satisfies Brain's security bar: manifest-based enrollment that needs no architecture change per platform ("a new platform enrolls with ~10 lines of JSON plus a health endpoint," `ADR-0014:37`), a scoped bearer token per platform that fails closed when unset (`services/guardian/src/health.js:28-31`), and defensive contract validation that never trusts a response body blindly (`health.js:54-56`). This design reuses that shape rather than inventing a new one. `Dot.Analytics`'s `analytics.view:*` endpoints (`dot-analytics.md:66,154,177`) prove live cross-platform reads already happen in the ecosystem, but their auth is plain Sanctum session/policy — no scope, no expiry, no ledger — so they are evidence the concept works, not a contract to extend.

## Goal

Ship the generic, *enrollable* capability — contract, Brain-side reader, manifest schema, and the governance record — the same way Guardian shipped generically before any platform enrolled:

1. The `dot-revenue/v1` contract: what a platform's read endpoint must serve, in what shape, under what auth.
2. A new Brain-owned service, `services/revenue-reader`, mirroring `services/guardian`'s shape, that polls enrolled platforms per their manifest.
3. A manifest schema and registry (`platforms/revenue-reader/<platform>.json`) for opt-in enrollment.
4. `ADR-0018`, documenting the governance decision: the exception to Rule 4, its exact scope, and its limits.
5. Doc updates: `brain.architecture.md` (new component, new trust-boundary line), `brain.security.md` (the new capability joins the audited capability list).

## Non-goals

- No platform's actual read endpoint gets built here. Dot.Billing exposing `GET /revenue/signals` is separate, coordinated work in Dot.Billing's own repository — this sub-project ends with infrastructure ready for a platform to enroll, not an enrolled platform.
- No raw pulled payload is ever persisted into the permanent Knowledge Graph. See §4.
- No changes to DKP publishing, the PR Generator, or Insight Delivery (ADR-0017) — this is a new, separate input stream feeding the same existing reasoning pipeline.
- Not the Revenue Intelligence analysis logic itself (opportunity detection, admin-user delivery) — that is the next sub-project, built on top of this one.

## 1. The `dot-revenue/v1` contract

A platform serves `GET /revenue/signals` with `Authorization: Bearer <token>`. Response:

```json
{
  "platform": "dot-billing",
  "contract": "dot-revenue/v1",
  "generated_at": "2026-09-23T10:00:00Z",
  "classification": "restricted",
  "signals": [
    {
      "key": "revenue.mrr",
      "value": 48210.55,
      "unit": "usd",
      "period": "2026-09",
      "trend": "up",
      "confidence": 0.95
    }
  ]
}
```

`classification` is required, one of the four existing tiers (`public|ecosystem|restricted|sensitive`, `brain.security.md:49`), and is the platform's own declaration of how sensitive this specific payload is — Brain does not infer it. Each entry in `signals[]` requires `key` and `value` at minimum; `unit`, `period`, `trend`, `confidence` are optional context.

Validation is defensive, mirroring `health.js:54-56`: a response is rejected as a contract failure (never partially trusted) if `signals` is not an array, if `classification` is missing or not one of the four known tiers, or if any signal entry lacks `key` or `value`. The contract exposes pre-aggregated business signals a platform itself computes and chooses to reveal — never raw transaction or PII-level records — mirroring Guardian's own principle of exposing operational signals, not internals (`health.js:5,13-14`). This is what keeps a multi-tenant platform in control of what crosses the boundary, satisfying the cross-tenant confidentiality rule ("cross-tenant inference prohibited except explicit sharing policies," `brain.governance.md:101`): the platform's own code decides what a signal aggregates over, not Brain.

## 2. Enrollment

`platforms/revenue-reader/<platform>.json`, mirroring Guardian's registry shape (`services/guardian/src/registry.js:4` `REQUIRED_KEYS`, purely additive per-platform):

| Key | Purpose |
|---|---|
| `platform` | platform id, e.g. `dot-billing` |
| `signals_url` | the platform's `dot-revenue/v1` endpoint |
| `token_env` | env var name holding this platform's bearer token (distinct namespace from Guardian's health tokens — see §3) |
| `poll_interval_s` | default `3600` — revenue signals move far slower than Guardian's health checks (`poll_interval_s` default `300`, `registry.js:8`), so the default cadence is an order of magnitude longer |
| `classification_ceiling` | the maximum classification this platform's manifest declares it may expose to this reader; a response exceeding it is rejected (§4) |

Enrolling a platform is one manifest file; the reader service and contract need no change to admit a new platform, identical to Guardian's "the architecture needs no change" property (`ADR-0014:37`).

## 3. Auth

A new capability-scoped bearer token per platform, declared per-manifest via `token_env`, structurally identical to Guardian's token handling (fail closed if unset, sent as `Authorization: Bearer <token>`, never committed). This is **not** the `ecosystem:read` Sanctum token used for SSO (`dot-infodot.md:94-95`) — that token is 5-minute, one-time-use, built for login redemption, the wrong shape for recurring API polling of financial data.

Token issuance and rotation stay platform-side: "one key system ecosystem-wide... no shared secrets between platforms, ever" (`brain.security.md:70,74`) — Brain never manufactures a platform's credential, only holds what that platform issues it. This capability joins the audited list: 90-day rotation, quarterly scope-audit against `brain.workflows.md` §6 (`brain.security.md:73`). Because financial-data tokens are higher-stakes than Guardian's health-check tokens, `token_env` names for this capability use a distinct naming convention (e.g. `DOT_<PLATFORM>_REVENUE_TOKEN`) so a revenue-signal token can never be confused with or accidentally substituted for a Guardian health token.

## 4. Persistence and data flow

The reader service polls, validates, and hands the `signals[]` array to the reasoning layer as ephemeral input — exactly how Guardian's `health.js` output feeds `decide.js`, never stored raw. No new Tier-0/1 graph node type is introduced; the existing W3 reasoning → W4 gates → Insight/Recommendation pipeline (already built this session for Insight Delivery, ADR-0017) consumes this as a new input stream, unchanged. Only a derived Insight or Recommendation is persisted, with an `evidence` entry of kind `external` — the `insight.schema.json` evidence-kind enum already includes `external` — referencing "read from `<platform>` at `<generated_at>`," never the raw payload.

This is the mechanism that keeps restricted financial-data exposure to a minimum footprint and respects Dot.Memory's "store without reading" boundary: the signal exists in Brain's working memory only for the span of one reasoning pass.

A response whose declared `classification` exceeds the enrolling platform's own `classification_ceiling` is rejected outright and raised as an incident — a safety rail beyond what Guardian needed, since a classification error on financial data is higher-stakes than one on a health check.

## 5. Governance — `ADR-0018`

Records: the decision to add a Brain-initiated pull path as an explicit, narrow exception to `CLAUDE.md` Rule 4, scoped exactly to pre-aggregated business signals (never raw records, never persisted raw); why Guardian's contract shape was reused rather than a new one invented; alternatives considered — extending DKP publishing cadence instead (rejected: does not give Brain control over *when* it asks, and depends on every platform redesigning its own publishing schedule) and waiting for platforms to adopt revenue-shaped DKP packs organically (rejected as too slow and uncontrollable, given the explicit choice for live access). Under the Decision Rights Matrix (`brain.governance.md:28-33`) this is both T3 (architectural, cross-platform) and T4 (ethical — financial data); sign-off for this ADR is the design approval already given in this session, standing in for that governance role in the absence of a separately staffed Ethics/Security Officer.

## Error handling

- Missing or invalid token: fail closed, no poll attempt, ledger-recorded — identical to Guardian.
- Malformed response (missing/invalid `classification`, non-array `signals`, a signal missing `key`/`value`): rejected as a contract failure, the body is never partially trusted, mirroring `health.js:54-56`.
- `classification` exceeds the manifest's `classification_ceiling`: rejected and raised as an incident (§4) — the one rejection mode Guardian's contract didn't need.
- Endpoint unreachable or timing out: elapsed-time-based availability tracking, not poll-count-based, mirroring Guardian's reasoning for the same choice — cron-based scheduling has enough variance that poll count alone is a poor failure signal (`health.js:105-133`).

## Testing

- Contract validation: a pure function per rejection branch (missing classification, invalid classification value, non-array signals, a signal missing `key`/`value`, classification-ceiling breach) — no network, mirroring `health.js`'s own test style.
- Manifest registry: load/validate tests mirroring Guardian's `registry.js` tests (required-keys enforcement, defaults applied, two manifests for two different platforms load independently).
- No platform is enrolled yet (§ Non-goals), so all tests exercise the reader against an injectable HTTP client — the same `fetchImpl` injection pattern already used by every service built this session (e.g. `services/insight-delivery`'s `memory-client.js`), not a real network call.

## Open questions

- Exact default `poll_interval_s` and per-signal staleness semantics (a `valid_until` on each signal, mirroring `insight.schema.json`'s own field) — `3600` is a reasonable starting default, to be revisited once a real platform enrolls and reveals how often its signals actually change.
- Whether `classification_ceiling` should be enforced Brain-side only, or also required as a hard assertion in the platform's own manifest (leaning toward both, for defense in depth, but not yet decided).
- Whether this capability's token type should be a structurally new token kind, or the same shape as Guardian's tokens under a different naming convention (§3 assumes the latter — same shape, distinct namespace — but this should be confirmed against `brain.security.md`'s "one key system ecosystem-wide" rule before implementation, to avoid accidentally creating a second key system).

## Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-09-23 | Brainstorming session | Initial design. |
