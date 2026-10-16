# Hourly Platform Collection

## Context

The owner wants Dot.Brain "always updated" on the state of the live Dot platforms, collected every hour. Today Brain has almost no recurring live feed:

- **Guardian** (`services/guardian`, ADR-0014) polls the `dot-guardian/v1` health endpoint of enrolled platforms every 5 minutes, but only to detect and remediate incidents. It keeps its own local store (`actions/cache`), not a queryable time series, and only two platforms are enrolled (`dot-mines`, `blupin`).
- **Revenue Reader** (ADR-0018) has no enrolled platform.
- The DKP publish/subscribe gateway described in `brain.dkp.md` §8 is not a running service.

"Live" is a smaller set than the 29 rows in `brain.platforms.md` §2, whose Status column tracks DKP integration stage, not deployment. Of the deployed apps, only Dot.Mines serves a machine-readable endpoint (`GET /guardian/health`); BluPin's health is served by Dot.Memory (`GET /api/guardian/blupin`). The other deployed apps (Central, Memory, Doc, Charts, Dopemine) serve nothing machine-readable yet.

**Where it runs.** Brain's established scheduler is GitHub Actions (`guardian-cron.yml`, `blupin-context.yml`). The deployed apps share ONE cPanel crontab, which three simultaneous deploys wiped on 2026-10-16 (F-INFRA-2026-001); Dot.Brain is not hosted there. The collector therefore runs from Dot.Brain's own Actions, not from that crontab.

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
| `health_url` | yes | the platform's `dot-guardian/v1` endpoint; must start with `https://` |
| `token_env` | yes | env var holding the bearer token for that endpoint |
| `timeout_ms` | no, default `15000` | per-request timeout; positive number |

Validation is strict, applying lessons from review of `services/revenue-reader`: required keys must be non-empty strings (not merely truthy); unrecognized keys are rejected rather than silently dropped; `timeout_ms` must be a positive finite number; a malformed JSON file or an invalid manifest fails with its filename; two manifests declaring the same `platform` are rejected (otherwise a second file could silently shadow or duplicate the first).

Day-one manifests:

| File | `health_url` | `token_env` |
|---|---|---|
| `dot-mines.json` | `https://mines.infodot.co.za/guardian/health` | `DOT_MINES_GUARDIAN_TOKEN` |
| `blupin.json` | `https://memory.infodot.co.za/api/guardian/blupin` | `DOT_MEMORY_TOKEN` |

Both tokens already exist as Dot.Brain repository secrets (used by `guardian-cron.yml`), so no new secret is created and the token-rotation audit in `brain.security.md` gains a second consumer, not a new credential.

**Enrollment is three steps, not one**, and this is a real limit: a manifest, a repository secret, and one `env:` line in the workflow that passes that secret to the job. GitHub Actions cannot hand a job "whichever secrets the manifests name" without exposing every secret (`toJSON(secrets)`), which is not acceptable. To keep this honest, a test asserts that every `token_env` named by a committed manifest appears in the workflow file, so an enrolled-but-never-passed token fails CI instead of failing silently at 17 minutes past the hour.

## 2. Fetch and validate

For each manifest, `GET <health_url>` with `Authorization: Bearer <token>` and `Accept: application/json`, bounded by `timeout_ms`. The shape check mirrors `services/guardian/src/health.js` (duplicated per this repo's convention, not imported): a response is accepted only if it is JSON, `status` is one of `healthy|warning|critical|unknown`, and `checks` is an object.

Every failure is classified, never thrown, using the vocabulary of ADR-0016 (health failure classification) as Guardian implements it, so the two services mean the same thing by the same word:

| `kind` | When |
|---|---|
| `unreachable` | DNS, connection refused, or timeout |
| `platform_error` | HTTP 5xx other than 503 |
| `maintenance` | HTTP 503 |
| `access` | HTTP 401/403 |
| `config` | HTTP 404, or the token env var is unset |
| `contract` | answered, but not valid JSON or not `dot-guardian/v1`-shaped |

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

`detail`: `{reachable, status, kind, reason, generated_at, check_count, checks}`, where `kind`/`reason` are null when reachable and `status`/`generated_at`/`checks` are null/empty when not. Each entry of `checks` is `{status, message, metrics}`. To keep a runaway platform from bloating Memory: at most 64 checks are kept (`check_count` still reports the true number), `message` is truncated to 240 characters, and `metrics` keeps only scalar values (finite numbers, strings truncated to 240, booleans) and at most 32 keys per check.

Because `event_id` embeds the UTC hour, a duplicate or late run inside the same hour updates the existing row (Memory's documented behavior) rather than adding one. Brain reads the series back through Memory's existing `GET /api/intelligence/context?subject_type=platform&subject_id=<platform>`; no new read surface is built.

## 4. Run behavior and exit codes

`platform-collector collect --manifest-dir platforms/collector [--dry-run]`

1. Load and validate all manifests (any invalid manifest aborts the run before any network call — a half-run would hide the bad file).
2. Fetch every platform concurrently; one platform's failure never affects another.
3. Record each result to Dot.Memory, independently. A write that fails with a network error or HTTP 5xx is retried twice (2 s then 5 s, injectable for tests); a 4xx is not retried.
4. Print a markdown table (platform, reachable, status, kind, recorded) and, when `GITHUB_STEP_SUMMARY` is set, append it there.

`--dry-run` fetches and prints but never writes.

| Exit | Meaning |
|---|---|
| `0` | every observation was recorded (platforms may themselves be down — that is data) |
| `1` | at least one observation could not be recorded after retries, or Dot.Memory is not configured |
| `2` | usage error, invalid manifest, or crash |

A platform being down keeps the run green, because alerting on it is Guardian's job. Inability to record turns the run red, because the whole point is that Brain is never silently stale.

## 5. The workflow

`.github/workflows/platform-collector.yml`: `schedule: '17 * * * *'` (minute 17 avoids the heavily queued top of the hour), `workflow_dispatch` with a `dry_run` boolean input, `concurrency: platform-collector` with `cancel-in-progress: false`, `permissions: contents: read`, `timeout-minutes: 10`. The job checks out, sets up Node 22, and runs the CLI with `DOT_MEMORY_URL`, `DOT_MEMORY_TOKEN`, and `DOT_MINES_GUARDIAN_TOKEN` in `env`.

GitHub's cron is best-effort and can start late or skip a run under load, so "hourly" means roughly hourly. The `event_id` design makes late and duplicate runs harmless; a skipped hour is simply absent.

## 6. Governance and docs

`ADR-0019` records: the choice of GitHub Actions over the shared cPanel crontab (with F-INFRA-2026-001 as the evidence); reuse of `dot-guardian/v1` rather than a new contract; the strict-failure rule above; and that this adds no trust boundary beyond ADR-0014's (an authenticated, Brain-initiated read of operational signals), and no raw business data. `brain.architecture.md` gains a Platform Collector row in §3 and a node in the §2 diagram. `services/platform-collector` is added to the `tests.yml` matrix and its `covered=` string.

## Error handling

- Missing/invalid manifest, duplicate platform, non-https URL, bad `timeout_ms`: abort with the filename, exit 2, before any request.
- Unset token, non-2xx, timeout, non-JSON, wrong shape: classified per §2 and recorded; run stays green.
- Dot.Memory unconfigured: exit 1 with a clear message (no silent skip, unlike a dry run).
- Dot.Memory write failure: retried per §4, then counted toward exit 1; other platforms' writes still proceed.
- Oversized `message`/`metrics` from a platform: truncated/capped per §3, never rejected.

## Testing

- `registry`: required keys, non-string values, unknown keys, non-https, bad `timeout_ms`, malformed JSON with filename, duplicate platform ids, defaults applied.
- `fetch`: one test per `kind` in §2 plus the success path, token unset, and body-shape rejection — all against an injectable `fetch`, no network.
- `record`: envelope fields all present and within Memory's 255-char limits; `event_id` stable within an hour and different across hours; `signature` forms; truncation and metric caps.
- `collect` (integration style, injectable fetch/clock/sleep): all up; one down (still exit 0, down platform recorded); Memory 5xx then success (retry); Memory persistently failing (exit 1, other platforms still recorded); Memory unconfigured (exit 1); `--dry-run` writes nothing.
- `workflow`: a test that every `token_env` in `platforms/collector/*.json` appears in `platform-collector.yml`, and that the cron expression is the hourly one.

## Open questions

- **Freshness watchdog.** Nothing yet notices if the collector itself stops (a disabled schedule, an expired secret). A natural fit is a Guardian check on "age of the latest `platform` observation in Memory ≤ 2 h"; deferred until the collector exists to be watched.
- **Retention.** Dot.Memory has no pruning; 24 rows per platform per day grows without bound. Fine at two platforms, worth a policy before ten.
- **Usage vocabulary.** `metrics` keys are each platform's own (as with Guardian checks). Whether Brain needs a shared cross-platform set of usage metric names is deferred until more than one platform reports usage.

## Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-10-16 | Brainstorming session | Initial design. |
