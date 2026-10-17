# Dot.Brain — Platform Collector

Hourly collector for the live platforms (design spec:
[docs/superpowers/specs/2026-10-16-hourly-platform-collection-design.md](../../docs/superpowers/specs/2026-10-16-hourly-platform-collection-design.md),
ADR: [ADR-0019](../../adr/ADR-0019-hourly-platform-collection.md)).

Once an hour, [`.github/workflows/platform-collector.yml`](../../.github/workflows/platform-collector.yml)
fetches each enrolled platform's `dot-guardian/v1` health document and records
one observation per platform to Dot.Memory (`POST /api/intelligence/events`),
so Brain's picture of the live platforms is refreshed hourly. It runs from
Dot.Brain's own GitHub Actions on purpose — not the shared cPanel crontab.
GitHub's scheduler is best-effort, so a run can start late or be skipped; the
cadence is unmeasured (see ADR-0019, Open questions).

It **records only**. It never remediates, opens incidents, or deploys — that is
[Guardian](../guardian/README.md).

## What gets recorded

One record per platform per UTC hour. `event_id` is
`collect-<platform>-<yyyymmddhh>`, so a late or duplicate run in the same hour
updates the existing row. A platform that is down is recorded as data
(`signature: failure:<kind>`, kinds per ADR-0016); a reachable one as
`status:<healthy|warning|critical|unknown>` with a compacted copy of its
checks and their `metrics`. A document whose `platform` differs from the
manifest's is recorded as `failure:contract`.

What you can read back today, from Dot.Memory's
`GET /api/intelligence/context?subject_type=platform&subject_id=<platform>`, is
the signature series (`status:*` / `failure:*` per hour) and the recurrence
counts. The per-check detail (checks, metrics, reason, `generated_at`) is stored
but not exposed by any Dot.Memory route yet, so it is write-only until that
follow-up lands (ADR-0019, Open questions).

## Enrolled platforms

| Platform | Endpoint | Token secret |
|---|---|---|
| `dot-mines` | `https://mines.infodot.co.za/guardian/health` | `DOT_MINES_GUARDIAN_TOKEN` |
| `dot-central` | `https://central.infodot.co.za/guardian/health` | `DOT_CENTRAL_GUARDIAN_TOKEN` |
| `dot-memory` | `https://memory.infodot.co.za/api/guardian/health` | `DOT_MEMORY_TOKEN` |
| `dot-dopemine` | `https://dopemine.infodot.co.za/guardian/health` | `DOT_DOPEMINE_GUARDIAN_TOKEN` |
| `dot-docs` | `https://doc.infodot.co.za/guardian/health` | `DOT_DOCS_GUARDIAN_TOKEN` |
| `dot-charts` | `https://charts.infodot.co.za/guardian/health` | `DOT_CHARTS_GUARDIAN_TOKEN` |
| `dot-projects` | `https://projects.infodot.co.za/guardian/health` | `DOT_PROJECTS_GUARDIAN_TOKEN` |
| `dot-forms` | `https://forms.infodot.co.za/guardian/health` | `DOT_FORMS_GUARDIAN_TOKEN` |
| `dot-engage` | `https://engage.infodot.co.za/guardian/health` | `DOT_ENGAGE_GUARDIAN_TOKEN` |
| `dot-press` | `https://pres.infodot.co.za/guardian/health` | `DOT_PRESS_GUARDIAN_TOKEN` |
| `dot-sheet` | `https://sheets.infodot.co.za/guardian/health` | `DOT_SHEET_GUARDIAN_TOKEN` |

## Enrolling another platform

1. The platform serves an authenticated `GET` returning a `dot-guardian/v1`
   document (see [Guardian's README](../guardian/README.md#the-platform-contract-dot-guardianv1)).
   Usage numbers go in a check's `metrics`.
2. Add `platforms/collector/<platform>.json`:

   ```json
   {
     "platform": "dot-example",
     "health_url": "https://example.infodot.co.za/guardian/health",
     "token_env": "DOT_EXAMPLE_GUARDIAN_TOKEN"
   }
   ```

   `dot-example` is a placeholder, not an enrolled platform. `health_url` must
   be an `https://` URL with a host and no credentials in it (`user:pass@` is
   rejected, and a rejected URL is never echoed in the error); `timeout_ms`
   (default 15000) is optional; unrecognized keys are rejected. Manifests load
   in sorted file order.
3. Add the token as a Dot.Brain repository secret, **and** one line to the
   workflow's `env:` block. GitHub Actions cannot pass "whichever secrets the
   manifests name" without exposing every secret, so this step is manual — a
   test fails CI if a manifest's `token_env` is missing from the workflow.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | every observation was recorded (platforms may themselves be down) |
| `1` | an observation could not be recorded after retries (including a platform's work crashing unexpectedly), or Dot.Memory is not configured for a real run (a `--dry-run` without it exits 0) |
| `2` | usage error, invalid or missing manifests, or a crash outside the per-platform work |

A platform being down keeps the run green; being unable to record turns it red.
A write is retried (2 s, then 5 s) only for network errors, 5xx and 403/408/429
(403 because of edge-WAF noise, ADR-0016); any other 4xx fails immediately. An
unexpected throw in one platform's work shows as kind `crash` in the table, is
not recorded, and does not stop the other platforms. Failing to write the job
summary is a warning, not a failure.

## Usage

Run these from `services/platform-collector`:

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
