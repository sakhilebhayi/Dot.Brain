# Dot.Brain — Platform Collector

Hourly collector for the live platforms (design spec:
[docs/superpowers/specs/2026-10-16-hourly-platform-collection-design.md](../../docs/superpowers/specs/2026-10-16-hourly-platform-collection-design.md),
ADR: [ADR-0019](../../adr/ADR-0019-hourly-platform-collection.md)).

Once an hour, [`.github/workflows/platform-collector.yml`](../../.github/workflows/platform-collector.yml)
fetches each enrolled platform's `dot-guardian/v1` health document and records
one observation per platform to Dot.Memory (`POST /api/intelligence/events`),
so Brain's picture of the live platforms is never stale. It runs from
Dot.Brain's own GitHub Actions on purpose — not the shared cPanel crontab.

It **records only**. It never remediates, opens incidents, or deploys — that is
[Guardian](../guardian/README.md).

## What gets recorded

One record per platform per UTC hour. `event_id` is
`collect-<platform>-<yyyymmddhh>`, so a late or duplicate run in the same hour
updates the existing row. A platform that is down is recorded as data
(`signature: failure:<kind>`, kinds per ADR-0016); a reachable one as
`status:<healthy|warning|critical|unknown>` with a compacted copy of its
checks and their `metrics`. Read the series back with Dot.Memory's
`GET /api/intelligence/context?subject_type=platform&subject_id=<platform>`.

## Enrolled platforms

| Platform | Endpoint | Token secret |
|---|---|---|
| `dot-mines` | `https://mines.infodot.co.za/guardian/health` | `DOT_MINES_GUARDIAN_TOKEN` |
| `blupin` | `https://memory.infodot.co.za/api/guardian/blupin` | `DOT_MEMORY_TOKEN` |

## Enrolling another platform

1. The platform serves an authenticated `GET` returning a `dot-guardian/v1`
   document (see [Guardian's README](../guardian/README.md#the-platform-contract-dot-guardianv1)).
   Usage numbers go in a check's `metrics`.
2. Add `platforms/collector/<platform>.json`:

   ```json
   {
     "platform": "dot-central",
     "health_url": "https://central.infodot.co.za/guardian/health",
     "token_env": "DOT_CENTRAL_GUARDIAN_TOKEN"
   }
   ```

   `health_url` must be `https://`; `timeout_ms` (default 15000) is optional;
   unrecognized keys are rejected.
3. Add the token as a Dot.Brain repository secret, **and** one line to the
   workflow's `env:` block. GitHub Actions cannot pass "whichever secrets the
   manifests name" without exposing every secret, so this step is manual — a
   test fails CI if a manifest's `token_env` is missing from the workflow.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | every observation was recorded (platforms may themselves be down) |
| `1` | an observation could not be recorded after retries, or Dot.Memory is not configured |
| `2` | usage error, invalid or missing manifests, or a crash |

A platform being down keeps the run green; being unable to record turns it red.

## Usage

```bash
# fetch and print only
node src/cli.js collect --manifest-dir ../../platforms/collector --dry-run

# fetch and record (needs DOT_MEMORY_URL, DOT_MEMORY_TOKEN, and each token_env)
node src/cli.js collect --manifest-dir ../../platforms/collector
```

You can also run the workflow by hand from the Actions tab (`dry_run` input available).

## Tests

```bash
npm test
```
