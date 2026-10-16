# Hourly Platform Collection

## Context

The owner wants Dot.Brain "always updated" on the state of the live Dot platforms, collected every hour. Today Brain has almost no recurring live feed:

- **Guardian** (`services/guardian`, ADR-0014) polls the `dot-guardian/v1` health endpoint of enrolled platforms every 5 minutes, but only to detect and remediate incidents. It keeps its own local store (`actions/cache`), not a queryable time series, and only two platforms are enrolled (`dot-mines`, `blupin`).
- **Revenue Reader** (ADR-0018) has no enrolled platform.
- The DKP publish/subscribe gateway described in `brain.dkp.md` §8 is not a running service.

"Live" is a smaller set than the 29 rows in `brain.platforms.md` §2, whose Status column tracks DKP integration stage, not deployment. Of the deployed apps, only Dot.Mines serves a machine-readable endpoint (`GET /guardian/health`); BluPin's health is served by Dot.Memory (`GET /api/guardian/blupin`). The other deployed apps (Central, Memory, Doc, Charts, Dopemine) serve nothing machine-readable yet.

**Where it runs.** GitHub Actions is where Brain's jobs run (`guardian-cron.yml`, `blupin-context.yml`), but its scheduler is not a dependable clock. Guardian's `*/5` cadence was measured at a median of about 2.5 hours (2026-08-27) and is now driven by an external dispatcher, a Cloudflare Worker calling `workflow_dispatch` (`services/guardian-trigger`). This hourly cron is unmeasured; the one comparable Brain cron that can be read, `blupin-context.yml`'s daily 03:05 UTC, started 18 to 32 minutes late across its last eight runs (run list read on 2026-10-16). `platform-collector.yml` already accepts `workflow_dispatch`, so if the first 48 hours show gaps the fix is one more dispatch from that worker (Open questions). The deployed apps share ONE cPanel crontab, which three simultaneous deploys wiped on 2026-10-16 (F-INFRA-2026-001); Dot.Brain is not hosted there. The collector therefore runs from Dot.Brain's own Actions, not from that crontab.

**Why not extend Guardian.** Guardian can deploy and roll back platforms (ADR-0014). Passive collection should not inherit that authority, and Guardian manifests require `repo`, `deploy`, and `autonomy_level` that a collection-only platform has no reason to declare.

## Goal

Ship `services/platform-collector`, following the exact conventions of every sibling service (ES modules, `node --test`, injectable `fetch`/env/clock, no dependencies, self-contained — no cross-service imports):

1. A manifest registry, `platforms/collector/<platform>.json`, for opt-in enrollment.
2. A collector that, once per run, fetches each enrolled platform's `dot-guardian/v1` health document and records one observation per platform to Dot.Memory.
3. An hourly GitHub Actions workflow, `.github/workflows/platform-collector.yml`.
4. Day-one enrollment of `dot-mines` and `blupin` (both already serve data).
5. `ADR-0019`, doc updates (`brain.architecture.md`), CI matrix and coverage-check registration.

## Non-goals

- No endpoint is built on any platform here. Central, Memory, Doc, Charts, and Dopemine each enroll later with a manifest plus a `dot-guardian/v1` endpoint, as separate PRs in those repositories.
- No remediation, no incident creation, no deploys — Guardian owns all of that.
- No new wire contract. The `dot-guardian/v1` document already carries a status plus per-check `metrics`; a platform that wants to report usage numbers puts them in a check's `metrics`.
- No backfill: a skipped hour is a gap, recorded as nothing.
- No retention or pruning in Dot.Memory (Open questions).
- No watchdog on the collector's own freshness (Open questions).
- No change to Guardian's cadence or manifests.

## 1. Enrollment

`platforms/collector/<platform>.json`:

| Key | Required | Purpose |
|---|---|---|
| `platform` | yes | platform id, e.g. `dot-mines`; unique across all manifests; must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` (it is embedded in `event_id`, `subject_id`, and a markdown table, so it must be plain and bounded) |
| `health_url` | yes | the platform's `dot-guardian/v1` endpoint; must parse as an `https:` URL with a host and no embedded credentials (`user:pass@`). The URL is never echoed in an error message, because run logs are public |
| `token_env` | yes | env var holding the bearer token for that endpoint |
| `timeout_ms` | no, default `15000` | per-request timeout; positive number |

Validation is strict, applying lessons from review of `services/revenue-reader`: required keys must be non-empty strings (not merely truthy); unrecognized keys are rejected rather than silently dropped; `timeout_ms` must be a positive finite number; a malformed JSON file or an invalid manifest fails with its filename; two manifests declaring the same `platform` are rejected (otherwise a second file could silently shadow or duplicate the first). Manifests load in sorted file-name order, so rows, writes and log lines do not depend on the filesystem's directory order.

Day-one manifests:

| File | `health_url` | `token_env` |
|---|---|---|
| `dot-mines.json` | `https://mines.infodot.co.za/guardian/health` | `DOT_MINES_GUARDIAN_TOKEN` |
| `blupin.json` | `https://memory.infodot.co.za/api/guardian/blupin` | `DOT_MEMORY_TOKEN` |

Both tokens already exist as Dot.Brain repository secrets (used by `guardian-cron.yml`), so no new secret is created and the token-rotation audit in `brain.security.md` gains a consumer, not a new credential. The Memory token now has three consumers (`guardian-cron.yml`, `blupin-context.yml`, the collector), with rotation due about 2026-11-23 under `brain.security.md` §4.

**Enrollment is three steps, not one**, and this is a real limit: a manifest, a repository secret, and one `env:` line in the workflow that passes that secret to the job. GitHub Actions cannot hand a job "whichever secrets the manifests name" without exposing every secret (`toJSON(secrets)`), which is not acceptable. To keep this honest, a test asserts that every `token_env` named by a committed manifest appears in the workflow file, so an enrolled-but-never-passed token fails CI instead of failing silently at 17 minutes past the hour.

## 2. Fetch and validate

For each manifest, `GET <health_url>` with `Authorization: Bearer <token>` and `Accept: application/json`, bounded by `timeout_ms`. The shape check mirrors `services/guardian/src/health.js` (duplicated per this repo's convention, not imported), with these divergences: a response is accepted only if it is JSON, `status` is one of `healthy|warning|critical|unknown`, and `checks` is an object, and the collector additionally rejects `checks: []` (an array is not an object of named checks), maps a non-string `generated_at` to null, and adds an identity check. A document whose `platform` is a string that differs from the manifest's is a `contract` failure (a mis-pointed or copied manifest must not be recorded as another platform's health); a document with no `platform` field is accepted. A body read that times out or is aborted is `unreachable`, not `contract`: the platform answered but never finished, and calling that a contract problem would send the reader looking at the wrong thing.

Every failure is classified, never thrown, using the vocabulary of ADR-0016 (health failure classification) as Guardian implements it, so the two services mean the same thing by the same word:

| `kind` | When |
|---|---|
| `unreachable` | DNS, connection refused, or timeout, including a body that starts and then stalls past the timeout; also a fetch that rejects with something that is not an `Error` or resolves to nothing. The reason names the underlying cause (`ECONNREFUSED`, `getaddrinfo ENOTFOUND ...`) when there is one |
| `platform_error` | HTTP 5xx other than 503 |
| `maintenance` | HTTP 503 |
| `access` | HTTP 401/403 |
| `config` | HTTP 404, or the token env var is unset |
| `contract` | answered, but not valid JSON, not `dot-guardian/v1`-shaped, or for a different platform than the manifest names |

An unset token is recorded as `config`, not skipped: a silent hole in the hourly series is worse than a recorded one.

## 3. The observation record

One record per platform per run, `POST {DOT_MEMORY_URL}/api/intelligence/events` with the same envelope `services/blupin-context` already uses and Dot.Memory's `LoopController::record` already validates:

| Field | Value |
|---|---|
| `loop_id` | `collect-<platform>-<UTC date>` — groups a platform's 24 daily observations |
| `event_id` | `collect-<platform>-<UTC yyyymmddhh>` — the idempotency key |
| `platform` | `dot-brain` (the recorder, as `blupin-context` does) |
| `source` | `platform-collector` |
| `subject_type` / `subject_id` | `platform` / `<platform>` |
| `subject_label` | `<platform> hourly state` |
| `occurred_at` | when the fetch completed (ISO-8601) |
| `signature` | `status:<status>` when a valid document was obtained, otherwise `failure:<kind>` — makes "how often was X down" a recall query |
| `detail` | see below |

`detail`: `{reachable, status, kind, reason, generated_at, check_count, checks}`, where `kind`/`reason` are null when reachable and `status`/`generated_at`/`checks` are null/empty when not. Each entry of `checks` is `{status, message, metrics}`. To keep a runaway platform from bloating Memory: at most 64 checks are kept (`check_count` still reports the true number), `generated_at` and `message` are truncated to 240 characters, check names and metric keys to 80, and `metrics` keeps only scalar values (finite numbers, strings truncated to 240, booleans) and at most 32 keys per check. Checks and metrics are copied as data, so a check or metric literally named `__proto__` is kept rather than silently dropped.

These bounds are about size, not content: the collector stores any scalar metric and any message up to 240 characters, with no classification check. That no raw business data is recorded is a contract with each platform's endpoint (operational signals only), not something the collector inspects.

Because `event_id` embeds the UTC hour, a duplicate or late run inside the same hour updates the existing row (Memory's documented behavior) rather than adding one. What is readable today, through Memory's existing `GET /api/intelligence/context?subject_type=platform&subject_id=<platform>`, is the signature series (`status:*` / `failure:*` per hour, as the `timeline`'s `at`, `signature` and generated `summary`) and the `recurrence` counts per signature. A record's `detail` (the checks, metrics, reason and `generated_at`) is stored but no Dot.Memory route exposes it, and `context` returns a subject's whole history unbounded. Per-check detail is therefore write-only until Dot.Memory exposes it (Open questions); no read surface is built here.

## 4. Run behavior and exit codes

`platform-collector collect --manifest-dir platforms/collector [--dry-run]`

1. Load and validate all manifests (any invalid manifest aborts the run before any network call — a half-run would hide the bad file).
2. Fetch every platform concurrently; one platform's failure never affects another. That includes an unexpected throw: it is caught per platform, shown in the table as kind `crash` (deliberately not one of the ADR-0016 kinds, since it is about the collector, not the platform), never recorded, and turns the run red; the other platforms are still recorded.
3. Record each result to Dot.Memory, independently. A write that fails with a network error, HTTP 5xx, or 403/408/429 is retried twice (2 s then 5 s, injectable for tests); any other 4xx (400, 401, 404, 422) is not retried. 403 is retried on evidence: ADR-0016 measured a 6.6% edge-WAF 403 rate from GitHub runner IPs to this shared host, which Dot.Memory is on, so treating it as terminal would turn one or two runs a day red on WAF noise and teach the owner to ignore the red signal. When the final attempt is a 403 the reason says so and points at ADR-0016.
4. Print a markdown table (platform, reachable, status, kind, recorded) and, when `GITHUB_STEP_SUMMARY` is set, append it there. The job-summary write is best-effort: if it fails, a warning goes to stderr and the exit code is unchanged.

`--dry-run` fetches and prints but never writes.

| Exit | Meaning |
|---|---|
| `0` | every observation was recorded (platforms may themselves be down — that is data) |
| `1` | at least one observation could not be recorded after retries (including a platform's work crashing unexpectedly), or Dot.Memory is not configured for a real run (a `--dry-run` without it exits 0) |
| `2` | usage error, invalid or missing manifests, or a crash outside the per-platform work (a top-level crash while collecting or printing) |

A platform being down keeps the run green, because alerting on it is Guardian's job. Inability to record turns the run red, because the whole point is that Brain is never silently stale.

## 5. The workflow

`.github/workflows/platform-collector.yml`: `schedule: '17 * * * *'` (minute 17 avoids the heavily queued top of the hour), `workflow_dispatch` with a `dry_run` boolean input, `concurrency: platform-collector` with `cancel-in-progress: false`, `permissions: contents: read`, `timeout-minutes: 10`. The job checks out (with `persist-credentials: false`, so the token is not left in the runner's git config), sets up Node 22, and runs the CLI with `DOT_MEMORY_URL`, `DOT_MEMORY_TOKEN`, and `DOT_MINES_GUARDIAN_TOKEN` in `env`.

GitHub's cron is best-effort: a run can start late or be skipped under load, and this job's real cadence is unmeasured (see Context). The `event_id` design makes late and duplicate runs harmless; a skipped hour is simply absent. The workflow already accepts `workflow_dispatch`, so an external dispatcher can drive it if gaps appear.

## 6. Governance and docs

`ADR-0019` records: the choice of GitHub Actions over the shared cPanel crontab (with F-INFRA-2026-001 as the evidence); reuse of `dot-guardian/v1` rather than a new contract; the strict-failure rule above; and that this adds no trust boundary beyond ADR-0014's (an authenticated, Brain-initiated read of operational signals), with no raw business data by contract (not inspected, per §3). `brain.architecture.md` gains a Platform Collector row in §3 and a node in the §2 diagram. `services/platform-collector` is added to the `tests.yml` matrix and its `covered=` string.

## Error handling

- Missing/invalid manifest, duplicate platform, non-https or credentialed or hostless URL, bad `timeout_ms`: abort with the filename (never the URL), exit 2, before any request.
- Unset token, non-2xx, timeout (including a stalled body), non-JSON, wrong shape, wrong platform: classified per §2 and recorded; run stays green.
- An unexpected throw in one platform's work: that row is shown as `crash` and not recorded, the others proceed, exit 1.
- Dot.Memory unconfigured: exit 1 with a clear message (no silent skip, unlike a dry run).
- Dot.Memory write failure: retried per §4 (network errors, 5xx, 403/408/429), then counted toward exit 1; other platforms' writes still proceed.
- Oversized `message`/`metrics` from a platform: truncated/capped per §3, never rejected.

## Testing

- `registry`: required keys, non-string values, unknown keys, non-https, unparseable/hostless/credentialed URLs (message never echoes the URL), bad `timeout_ms`, malformed JSON with filename, duplicate platform ids, defaults applied, sorted load order.
- `fetch`: one test per `kind` in §2 plus the success path, token unset, body-shape rejection, the identity check (mismatch, absent, match), a fetch that rejects with `null`/a string or resolves nothing, and a real `node:http` server that stalls mid-body (must come back `unreachable` within the timeout). Otherwise against an injectable `fetch`, no network.
- `record`: envelope fields all present and within Memory's 255-char limits; `event_id` stable within an hour and different across hours; `signature` forms; truncation and metric caps; `__proto__` keys survive; `generated_at` and key-name clipping.
- `memory`: retry on network errors, 5xx and 403/408/429; 400/401/404/422 terminal; a persistent 403 names ADR-0016; a non-Error rejection never throws.
- `collect` (integration style, injectable fetch/clock/sleep): all up; one down (still exit 0, down platform recorded); Memory 5xx then success (retry); Memory persistently failing (exit 1, other platforms still recorded); an unexpected throw in one platform (that row unrecorded, the other recorded, exit 1); Memory unconfigured (exit 1); `--dry-run` writes nothing. The CLI is also run as a subprocess for the exit-1 contained crash and the exit-2 top-level crash.
- `workflow`: a test that every `token_env` in `platforms/collector/*.json` appears in `platform-collector.yml`, and that the cron expression is the hourly one.

## Open questions

- **Measure the cadence for 48 hours after merge.** Compare each run's start time against minute 17 and count missed hours. If there are gaps, add an hourly `workflow_dispatch` of `platform-collector.yml` to the Cloudflare Worker that already drives Guardian (`services/guardian-trigger`); the workflow already accepts it.
- **Dot.Memory follow-ups** (separate PRs in that repository): expose an observation's `detail` through a route, since it is write-only today (§3); `BlupinLoopReport` emits `summary` rather than `message` and no `metrics`, so every `blupin` observation stores an empty message and empty metrics (verified); and `context` returns a subject's whole history unbounded, so it needs a limit or window before it is read at hourly volume.
- **Freshness watchdog.** Nothing yet notices if the collector itself stops (a disabled schedule, an expired secret). A natural fit is a Guardian check on "age of the latest `platform` observation in Memory ≤ 2 h"; deferred until the collector exists to be watched. Note that GitHub automatically disables scheduled workflows in a public repository after 60 days without repository activity, so a quiet repo can switch this job off without any error.
- **Public run logs.** This is a public repository, so the run logs and job summary expose each platform's reachability and status every hour. Accepted and noted. Tokens are never printed, and manifest errors never echo a URL.
- **Retention.** Dot.Memory has no pruning; 24 rows per platform per day grows without bound. Fine at two platforms, worth a policy before ten.
- **Usage vocabulary.** `metrics` keys are each platform's own (as with Guardian checks). Whether Brain needs a shared cross-platform set of usage metric names is deferred until more than one platform reports usage.

## Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-10-16 | Brainstorming session | Initial design. |
| 1.0.1 | 2026-10-16 | Whole-branch review | Corrected two claims: observation `detail` is not readable through `context` (only the signature series and recurrence are), and GitHub's scheduler is not a dependable clock (Context, §5, Open questions). Synced the spec with the code: `health_url` must be https with a host and no credentials and is never echoed; manifests load sorted; the shape check's divergences from `health.js` and the platform identity check (§2); `generated_at` and key-name bounds, `__proto__` safety, and the no-content-inspection note (§3); retries on 403/408/429, per-platform isolation of unexpected throws, exit codes and best-effort job summary (§4); `persist-credentials: false` (§5); Memory token now has three consumers. New Open questions: cadence measurement, Dot.Memory follow-ups, 60-day auto-disable, public run logs. |
