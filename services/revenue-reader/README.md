# Dot.Brain — Revenue Reader

Brain-initiated pull reader for the `dot-revenue/v1` contract (design spec:
[docs/superpowers/specs/2026-09-23-cross-platform-read-access-design.md](../../docs/superpowers/specs/2026-09-23-cross-platform-read-access-design.md),
ADR: [ADR-0018](../../adr/ADR-0018-cross-platform-read-access.md)).

Mirrors Dot Guardian's contract shape (`services/guardian`, ADR-0014):
manifest-based enrollment, a scoped bearer token per platform, and
defensive validation that never trusts a response body blindly. Unlike
Guardian, this reads pre-aggregated business signals rather than health
checks, so every response also declares a `classification`
(`public|ecosystem|restricted|sensitive`) that must not exceed the
enrolling platform's own manifest-declared ceiling.

## No platform is enrolled yet

This ships the generic capability only. A platform enrolls by adding a
manifest to `platforms/revenue-reader/<platform>.json` and exposing a
`GET /revenue/signals` endpoint — that endpoint is separate, coordinated
work in the platform's own repository (design spec Non-goals).

## Manifest shape

```json
{
  "platform": "dot-billing",
  "signals_url": "https://billing.dot/revenue/signals",
  "token_env": "DOT_BILLING_REVENUE_TOKEN",
  "poll_interval_s": 3600,
  "timeout_ms": 15000,
  "classification_ceiling": "restricted"
}
```

Only `platform`, `signals_url`, and `token_env` are required; the rest
default per `src/registry.js`'s `DEFAULTS`.

## Pipeline

1. `loadManifests()` — reads and validates every manifest in a directory.
2. `pollPlatform()` — one poll attempt: fails closed with `kind: 'auth'`
   if the token env var is unset (no network call is made), reports
   `kind: 'network'` on a fetch failure or non-2xx status, `kind:
   'contract'` on a malformed response body, or `kind:
   'classification_ceiling'` if the response is more sensitive than the
   platform's manifest allows. A successful poll returns exactly
   `{ok, platform, generated_at, classification, signals}` — nothing
   else, and nothing is persisted.

A stateful, multi-poll availability tracker (mirroring Guardian's
`detect.js`/`store.js`) needs a scheduling loop accumulating poll history
over time to have anything to track — and no such loop exists yet (the
design spec's Non-goals scope it out, since no platform is enrolled to
schedule against). Today, an unreachable or timed-out endpoint is
reported as a single-poll `kind: 'network'` result, same as any other
poll failure; availability tracking is deferred until a scheduler exists.

## Usage

```bash
revenue-reader poll --manifest-dir platforms/revenue-reader
```

## Tests

```bash
npm test
```
