---
title: Dot Ecosystem — Live Platform Reliability Audit
date: 2026-10-16
status: baseline established; fixes in review; production verification pending owner merges
author: Reliability pass (Claude, with owner sakhilebhayi)
scope: every repository under ~/Dot, every *.infodot.co.za host, GitHub Actions evidence, public health endpoints, sanctioned read-only server-evidence workflows
---

# Dot Ecosystem — Live Platform Reliability Audit (2026-10-16)

Evidence rules used throughout: a platform is **Live** only when its host answers with the real application (a Laravel session cookie and the app's own pages), not because its code exists. Server-side state that could only be seen over SSH is marked **Not Verified**; the host's SSH was not used in this pass (the sanctioned paths are each repo's `server-logs` / `server-inspect` workflows, and Dot.Mines' was run). All times UTC.

## 1. Inventory and verified deployment status

33 repositories live under `~/Dot`; 32 subdomains were probed. 12 hosts serve a real application, 7 serve a static "Coming Soon" page, 12 do not resolve.

### 1.1 Live (real application answering)

| Platform | Host | Deploy path | Health surface | Monitoring from outside the host | Verdict |
|---|---|---|---|---|---|
| InfoDot (SSO hub, community) | infodot.co.za | **none** (manual; `PRODUCTION_DEPLOYMENT.md` describes hand steps) | `/` only (`/up` 404) | none | Live, **unmanaged** |
| Dot.Mines | mines.infodot.co.za | GitHub `deploy.yml` on push to main; `/ready` gate; maintenance mode; crontab block with lock + read-retry | `/ready`, `/up`, `/up/realtime`, `GET /guardian/health` (bearer) | Guardian (5-min, 9 checks), scheduler watchdog (15-min), hourly collector, `server-logs.yml` | Live, managed |
| Dot.Central | central.infodot.co.za | `deploy.yml` on push; `/up` gate | `/up`, `/up/scheduler` | scheduler watchdog (15-min) | Live, managed |
| Dot.Memory | memory.infodot.co.za | `deploy.yml` (dispatch, `confirm=deploy`) | `/up`; `/up/scheduler` **in PR #12** | none today; watchdog in PR #12 | Live, managed |
| Dot.Dopemine | dopemine.infodot.co.za | `deploy.yml` (dispatch) | `/up`; `/up/scheduler` **in PR #6** | none today; watchdog in PR #6 | Live, managed |
| Dot.Doc | doc.infodot.co.za | `deploy.yml` on push + CI + live smoke check | `/up`; `/up/scheduler` **in PR #24** | none today; watchdog in PR #24 | Live, managed |
| Dot.Charts | charts.infodot.co.za | `deploy.yml` (dispatch); analytics keepalive via `setup-analytics.yml` | `/up`; `/up/scheduler` **in PR #5** | none today; watchdog in PR #5 | Live, managed |
| Dot.Agents | agents.infodot.co.za | `deploy.yml` exists but **has never completed** (8/8 runs failed since 2026-09-19, all at the composer audit gate) | `/up`, `/health` → `{"status":"ok"}` | none | Live, **provenance unknown** |
| Dot.Files | files.infodot.co.za | **none** | `/up` → **HTTP 500** (see D1) | none | Live, **broken health, unmanaged** |
| Dot.Forms | forms.infodot.co.za | **none** | `/up` 200 | none | Live, unmanaged (queue worker Not Verified) |
| Dot.Projects | projects.infodot.co.za | **none** | `/up` 200 | none | Live, unmanaged (realtime Not Verified) |
| Dot.Engage | engage.infodot.co.za | **none** | `/up` 200 (title "Laravel") | none | Live, unmanaged (realtime Not Verified) |

Dot.Brain has no host: it is **live as a service** from GitHub Actions (Guardian poll every 5 min, triggered by a Cloudflare Worker cron; hourly Platform Collector; CI on every PR). BluPin was retired on 2026-10-16 (Dot.Charts #4, Dot.Brain #22, Dot.Memory #11) and is not a platform.

### 1.2 Placeholder (static "Coming Soon" page, no application)

Dot.Emall, Dot.Ehail, Dot.Auction, Dot.Tasks, Dot.Design, Dot.Finance, Dot.Tutor. Classified **Staging/Placeholder**. Their repositories build (Laravel apps with recent commits up to 2026-09-23) but nothing is deployed.

### 1.3 Development only (no DNS record)

Dot.Analytics, Dot.Pulse, Dot.Notify, Dot.Billing, Dot.Plug, Dot.Farms, Dot.HR, Dot.Press, Dot.Sheet, Dot.Assets (HTML prototype). `docs.infodot.co.za` also does not resolve (the live host is `doc.`). Note the shared registry (`InfoDot/config/ecosystem.php`) defaults every platform to `*.infodot.app` and marks all but Charts `active: true`; it does not reflect this inventory.

## 2. Ecosystem dependency and data-flow map

```
Bell Equipment API ──(15-min cadence)──▶ Dot.Mines (sync, telemetry, alerts)
                                            │  webhooks POST /webhooks/mines/{id}      (228 delivered / 0 failed, 24 h)
                                            ├───────────────────────────────▶ Dot.Central (mirror, freshness, shifts, rules)
                                            │  GET /api (equipment, geofences)     ◀──── sync every few minutes
                                            │
                                            │  outbox ─▶ POST /api/intelligence/events ─▶ Dot.Memory  (382 sent / 0 pending / 0 stuck)
                                            │                                              ▲
Dot.Central ── outbox (every minute) ──────────────────────────────────────────────────────┤
                                                                                           │
GitHub Actions (Dot.Brain)                                                                 │
  Guardian ── GET /guardian/health (Dot.Mines) ── incidents/recall ────────────────────────┤
  Platform Collector (hourly) ── GET /guardian/health (Dot.Mines) ── events ───────────────┘
  Guardian ── GitHub issues (Dot.Mines) ── runbooks (advisory / redeploy; autonomy level 2 = recommend only)
Cloudflare Worker cron ── workflow_dispatch ──▶ Guardian poll (5-min cadence)

InfoDot ── ecosystem SSO handoff (/auth/ecosystem) ──▶ Memory, Dopemine, Doc, Central, Files, Forms, Engage, Projects
Dot.Files ◀──▶ Dot.Doc (document rows, handoff, signed inline viewer)
Dot.Brain reasoning ──▶ Dot.Dopemine POST /api/intelligence/interventions (certified mechanics only)

Shared substrate (single point of failure): ONE cPanel account on ONE LiteSpeed host (198.38.92.233),
ONE crontab for Mines/Central/Memory/Doc/Charts/Dopemine (9 lines), SQLite files for Central, Memory,
Dopemine, Doc, Charts; Mines/InfoDot/Files/Forms/Projects/Engage/Agents database engine Not Verified.
```

Data ownership is clear where it is wired: Dot.Mines owns fleet truth; Dot.Central owns shifts, line-ups, audit; Dot.Memory owns the incident and intelligence record; Dot.Brain owns reasoning and never edits platform files. Cross-platform writes already use durable outboxes (Mines → Memory, Central → Memory) and idempotent keys (`event_id`, `incident_uid`, collector `collect-<platform>-<hour>`).

## 3. Confirmed defects, fixes, and evidence

| ID | Platform | Defect (root cause) | Fix | Evidence |
|---|---|---|---|---|
| D1 | Dot.Files | `GET /up` answers **HTTP 500** and the body carries the full exception and stack trace, disclosing server paths (`/home/infodotc/files.infodot.co.za/dotfiles/...`). Root cause: the route cache on the server was compiled in a GitHub Codespace (`/workspaces/Dot.Files/...`) and shipped by hand, so the framework's health view path is wrong on the host. | **Not fixed** — needs `php artisan route:clear && route:cache` on the host (no pipeline, no sanctioned workflow, SSH not used in this pass). | `curl -sD- https://files.infodot.co.za/up` → `HTTP/2 500`, body quotes `FileNotFoundException ... /workspaces/Dot.Files/vendor/...` |
| D2 | Dot.Agents | Every CI, security and deploy run on main red since 2026-09-19: `composer audit` fails on phpseclib 3.0.55 (CVE-2026-84308), symfony/yaml 8.1.0 (CVE-2026-109413), league/commonmark 2.10.1 (2 advisories). | [Dot.Agents #4](https://github.com/sakhilebhayi/Dot.Agents/pull/4): lock-file update to 3.0.57 / 8.1.9 / 2.10.3. | Local `composer audit` clean; PR CI: Composer Vulnerability Audit **pass**, Dependency Security Audit **pass**, PHPStan/OWASP/secrets pass; PHPUnit jobs were still running at write time. Merge caution recorded in the PR (merge triggers an unverified first automated deploy). |
| D3 | InfoDot | CI red on every run since 2026-08-07: `composer install` runs `package:discover` before `.env` exists, the broadcaster resolves to `reverb` with null credentials and throws. The PHP 8.3 matrix leg could never install (composer.json `php ^8.4`). | [InfoDot #2](https://github.com/sakhilebhayi/InfoDot/pull/2): create `.env` before install, generate the key after, seed against the SQLite file CI creates, test on 8.4 only. | First commit: `tests (8.4)` **pass** (first green run since August); 8.3 leg failed on the platform requirement and was removed in the second commit. |
| D4 | Memory, Dopemine, Doc, Charts | No liveness signal for the cron scheduler (or Doc's queue worker). `/up` proves the web tier boots only; the 2026-10-16 shared-crontab wipe would have been invisible on these four. | PRs [Dot.Memory #12](https://github.com/sakhilebhayi/Dot.Memory/pull/12), [Dot.Dopemine #6](https://github.com/sakhilebhayi/Dot.Dopemine/pull/6), [Dot.Charts #5](https://github.com/sakhilebhayi/Dot.Charts/pull/5), [Dot.docs #24](https://github.com/sakhilebhayi/Dot.docs/pull/24): public `/up/scheduler` (same contract as Dot.Central), minute heartbeat, Doc also a 5-minute `QueueHeartbeat` job, and a 15-minute GitHub `Scheduler Watchdog` per repo. | Feature tests pass locally (Memory 2/2, Dopemine 2/2, Charts 2/2, Doc full suite 537 passed / 4 skipped); Pint clean. **Not yet deployed**: merge + dispatch were blocked for this session (production-deploy permission). |
| D5 | Dot.Charts | `blupin-daily` fired and failed every weekday 2026-10-14..16 (branch protection rejected its journal push) after the engine was retired. | Already removed on main by #4 (merged 20:56 UTC); the Guardian manifest and Memory endpoint were retired by Dot.Brain #22 and Dot.Memory #11. | `git ls-tree origin/main .github/workflows` no longer lists it. |
| D6 | Dot.Mines | `/up/realtime` → 503 `degraded`: production `BROADCAST_DRIVER=pusher`, nothing listening on 127.0.0.1:8080. Eight `ShouldBroadcast` events have no live channel. | Not fixed. `deploy.yml` documents this as expected on shared hosting (report, don't gate). Whether `pusher` with empty credentials is queueing failing broadcast jobs is **Not Verified** (`failed_jobs` last 24 h = 0 suggests not). | `/up/realtime` body; `server-logs.yml` run 38974448853 "Queue evidence". |
| D7 | Dot.Memory | Three incidents still `open` in `/api/ops/incidents`: `grd-blupin-20261015040553-037b` (sev2), `grd-blupin-20260831213553-1760` (sev3), `grd-dot-mines-20260827130519-e671` (sev3, 50 days). The BluPin ones belong to a retired platform; the Mines one resolved in August but the record was never patched. | Not changed (owner-only per the existing rule for the BluPin incident). | `GET /api/ops/incidents?status=open` at 22:08 UTC. |
| D8 | Dot.Mines → Dot.Memory | `memory:flush` failed with exit 1 every minute 18:01–18:11 UTC today (service-token re-provisioning window: Memory "Provision Service Token" ran 17:22 and 18:09). | Self-healed: the outbox held the rows and drained once the token was valid (sent 382, pending 0, stuck 0 at 22:11). No change needed; recorded so the pattern is known. | `server-logs.yml` run 38974448853 "Scheduler evidence" and "Dot.Memory outbox status". |

## 4. Reliability baseline (measured 2026-10-16, 22:00–22:25 UTC)

| Measure | Value | Source |
|---|---|---|
| Availability, 12 live hosts | 12/12 answered 200 on every one of 3 samples | curl from this workstation |
| Home-page response time (3 samples each) | 0.67–1.77 s; Projects slowest (1.5–1.8 s), Files fastest (0.67 s) | curl `%{time_total}` |
| Dot.Mines guardian health | 9/9 checks healthy (database, cache, queue, scheduler, error_rate, integration_sync, telemetry_ingestion, provider_data_freshness, production_freshness) | `GET /guardian/health` 22:07:54 Z |
| Dot.Mines queue | 1 ready job (11 s old), 0 failed jobs in 24 h | server-logs run 38974448853 |
| Dot.Mines → Central webhooks | 228 delivered / 0 failed in 24 h, endpoint `consecutive_failures=0` | same |
| Dot.Mines → Memory outbox | 382 sent, 0 pending, 0 stuck; last sent 22:11:08 | same |
| Dot.Central scheduler / queue | heartbeat ages 49 s / 45 s (stale after 180 / 900) | `GET /up/scheduler` |
| Guardian poll cadence | runs at 21:45, 21:49, 21:50, 21:55, 21:57, 22:00 (Cloudflare trigger live) | Dot.Brain Actions |
| Platform collector | 5/5 runs green today; records dot-mines only | Dot.Brain Actions |
| Scheduled-workflow health | Dot.Mines + Dot.Central scheduler watchdogs green all evening | Actions |
| Backups in code | Dot.Central nightly SQLite copy 02:15 only; Memory, Dopemine, Doc, Charts: **none in code**; host-level backups Not Verified | repo grep |

## 5. Reliability standards applied (and where each already lives)

- **Freshness states.** Live / Delayed / Stale / Unavailable / Unknown map onto what the code already computes: Dot.Central per-equipment `fresh` (≤2× provider cadence), `stale` (≤4×), `missing` (beyond, or never heard, state Unknown); Dot.Mines `provider_data_freshness` names Bell when readings are ≥4× its 15-minute baseline and `production_freshness` reports `unknown` while input starves rather than inventing zeros. The new probes report `ok` / `stale` with the age in seconds and `null` when nothing was ever recorded. Nothing substitutes zero for missing.
- **Availability.** Every live host must expose `/up` (web tier) and `/up/scheduler` (scheduler, and queue where one exists), and be asked from outside the host every 15 minutes. Satisfied today by Mines and Central; by Memory, Dopemine, Doc, Charts once the four PRs deploy; not by InfoDot, Agents, Files, Forms, Projects, Engage.
- **Traceability.** Guardian incidents carry health excerpts and runbook decisions; Memory incidents are patched with `record.resolution {cause, fix, lesson}`; outboxes keep attempts and sent timestamps; deploy logs print `== crontab: N line(s) ... M other line(s) preserved` and N+M must equal 9.
- **Recovery.** Outboxes replay (proved by D8); webhook deliveries retry with per-endpoint failure counts; Guardian runbooks are recommend-only (autonomy level 2) until the scenario suite runs against staging.
- **Security.** Bearer-authenticated health on Mines; Sanctum service tokens hashed at rest on Memory; no secrets in watchdog workflows (public host names only). Open: D1 path disclosure; Guardian PATs expire ~2026-11-25.
- **Verification.** Every fix above lists its evidence; anything that could not be observed is Not Verified, not assumed.

## 6. Deployment, rollback, backup and incident procedures (as they exist today)

- **Deploy.** Mines, Central, Doc: push to `main` deploys (CI/quality gate first on Mines and Doc). Memory, Dopemine, Charts: `gh workflow run deploy.yml -f confirm=deploy`. Every pipelined deploy: `artisan down` → pull → migrate → caches → crontab block under `flock` with read-retry → `queue:restart` → `artisan up` → health gate (`/ready` or `/up`). **Run deploys one at a time** and check the crontab line (N+M=9).
- **Rollback.** Deploys are git-based: revert the commit on `main` and deploy again (push repos) or dispatch again (dispatch repos). A red deploy leaves the site in maintenance mode on purpose: inspect, then re-run. Check `/up/scheduler` after any red deploy.
- **Backups.** Central: nightly SQLite copy. Memory, Dopemine, Doc, Charts: none in code (risk R2). Agents/InfoDot/Files/Forms/Projects/Engage: Not Verified.
- **Incident response.** Guardian opens a GitHub issue on Dot.Mines with the decision block and a health excerpt (read to the end); check the latest poll before acting, since warnings self-clear; follow the runbook (`advisory` = contact provider, `redeploy` = re-run deploy); patch the Memory incident with the resolution; close the GitHub issue by hand (Guardian does not).

## 7. Risk register (prioritised)

| # | Risk | Impact | Likelihood | Owner action |
|---|---|---|---|---|
| R1 | Dot.Files health endpoint 500 with path disclosure; stale Codespace route cache on the host (D1) | security + availability | certain (observed) | clear/rebuild route cache on the host; give Dot.Files the bootstrap/deploy/server-logs trio |
| R2 | One host, one account, one crontab, SQLite for five apps, backups only for Central | total data loss on host failure | medium | nightly SQLite backups off-host for Memory, Dopemine, Doc, Charts; confirm cPanel backup policy |
| R3 | Five live apps with no pipeline or evidence path (InfoDot, Files, Forms, Projects, Engage) | cannot repair, deploy or observe safely | certain | pipelines + `/up/scheduler` for each; decide which stay live |
| R4 | Dot.Agents: production provenance unknown, deploy never exercised, local checkout diverged from origin | unknown what runs in production; first automated deploy is untested | high | merge #4; run deploy manually with rollback ready, or reconcile the host by hand first |
| R5 | Guardian and collector see only Dot.Mines | silent failures elsewhere | high until the four watchdog PRs deploy | merge/deploy #12, #6, #5, #24; then enroll Central, Memory, Dopemine, Doc, Charts with `dot-guardian/v1` endpoints |
| R6 | Reverb realtime not possible on shared hosting: Mines broadcasts, Engage chat, Projects live boards silently non-live | features look live but are not | certain for Mines (observed); Not Verified for Engage/Projects | either a hosted broadcaster (Pusher keys) or remove the live affordances |
| R7 | Three stale open incidents in Memory (D7) | AI/knowledge layer reasons over wrong state | low | owner patches/closes |
| R8 | Guardian PATs (`GUARDIAN_GH_TOKEN`, Cloudflare trigger PAT) expire ~2026-11-25 | monitoring stops silently | certain on date | rotate before 2026-11-20 |
| R9 | Shared registry (`config/ecosystem.php`) marks placeholders active and points at `infodot.app` | error pages and discover surfaces send users to dead hosts | certain | update URLs/active flags from §1 |
| R10 | `APP_NAME` unset on Charts and Engage production (`/up` title "Laravel"; Doc/Forms mail templates hard-code the name for the same reason) | cosmetic, trust | certain | set `APP_NAME` in each `.env` |

## 8. Proposed service targets (not guarantees)

| Objective | Target | Measured by | Period | Escalation |
|---|---|---|---|---|
| Availability per live host | 99.5 % (shared hosting; 99.9 % is not credible) | 15-minute watchdog + Guardian polls | monthly | 2 consecutive failures → owner email (watchdog) / Guardian sev1 after 600 s |
| Scheduler liveness | heartbeat age ≤ 180 s | `/up/scheduler` | continuous | watchdog failure |
| Queue liveness (Central, Doc) | queue heartbeat age ≤ 900 s | `/up/scheduler` | continuous | watchdog failure |
| Mines telemetry freshness | ≤ 2× Bell cadence (30 min); provider stalls are named, never blamed on the pipeline | Guardian `telemetry_ingestion`, `provider_data_freshness` | continuous | warning only |
| Central equipment freshness | fresh ≤ 2× cadence; stale 2–4×; missing beyond | FreshnessEvaluator | continuous | board shows state |
| Cross-platform delivery | outbox pending/stuck = 0 within 5 min; webhook failures = 0/24 h | server-logs evidence, Central health page | daily | any stuck row |
| Incident detection | ≤ 10 min (two Guardian polls) | Guardian | per incident | sev1 escalate |
| Recovery | red deploy → site back ≤ 30 min | Actions timestamps | per incident | — |
| Data loss | ≤ 24 h once nightly backups exist for every SQLite app | backup command logs | daily | missing backup |

## 9. Tests and failure-simulation results

- Added: `SchedulerProbeTest` in Memory, Dopemine, Charts (fresh / stale / never-recorded / no-auth) and Doc (plus dead-worker and job-records-time). All pass locally.
- Existing suites exercised: Dot.docs full suite 537 passed / 4 skipped; Dot.Agents PHPUnit jobs run on PR #4 (results in the PR).
- Failure scenarios covered by observation today: expired/rotated credential (D8, recovered by outbox replay); provider stall classification (Guardian history); shared-crontab wipe and transient empty `crontab -l` (fixed earlier today, lock + read-retry).
- **Not run**: controlled staging simulations for database/cache/queue failure, duplicated or out-of-order events, cross-platform desync, resource exhaustion. There is no staging environment; marked Not Verified below.

## 10. Status matrix

Legend: ✅ Passed · ❌ Failed · ◐ Partially implemented · ◌ Not verified

| Platform | Live | Deploy pipeline | Web health | Scheduler/queue probe | Outside watchdog | Guardian enrolled | Backups | Test gate | Security audit |
|---|---|---|---|---|---|---|---|---|---|
| Dot.Mines | ✅ | ✅ | ✅ | ✅ (guardian health) | ✅ | ✅ | ◌ | ✅ | ◌ |
| Dot.Central | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ nightly | ✅ CI | ◌ |
| Dot.Memory | ✅ | ✅ | ✅ | ◐ PR #12 | ◐ PR #12 | ❌ | ❌ | ◐ no CI | ◌ |
| Dot.Dopemine | ✅ | ✅ | ✅ | ◐ PR #6 | ◐ PR #6 | ❌ | ❌ | ◐ no CI | ◌ |
| Dot.Doc | ✅ | ✅ | ✅ | ◐ PR #24 | ◐ PR #24 | ❌ | ❌ | ✅ CI + smoke | ✅ (#22 advisories) |
| Dot.Charts | ✅ | ✅ | ✅ | ◐ PR #5 | ◐ PR #5 | ❌ | ❌ | ◐ no CI | ◌ |
| Dot.Agents | ✅ | ❌ never green | ✅ `/health` | ❌ | ❌ | ❌ | ◌ | ◐ PR #4 | ◐ PR #4 |
| InfoDot | ✅ | ❌ none | ◐ `/` only | ❌ | ❌ | ❌ | ◌ | ◐ PR #2 | ◌ |
| Dot.Files | ✅ | ❌ none | ❌ 500 + leak | ❌ | ❌ | ❌ | ◌ | ◌ | ❌ (D1) |
| Dot.Forms | ✅ | ❌ none | ✅ | ❌ | ❌ | ❌ | ◌ | ◌ | ◌ |
| Dot.Projects | ✅ | ❌ none | ✅ | ❌ | ❌ | ❌ | ◌ | ◌ | ◌ |
| Dot.Engage | ✅ | ❌ none | ✅ | ❌ | ❌ | ❌ | ◌ | ◌ | ◌ |
| Dot.Brain (service) | ✅ Actions | ✅ | n/a | ✅ poll cadence | ✅ Cloudflare | self | ✅ cache | ✅ CI | ◌ |
| Placeholders (7) | static | — | — | — | — | — | — | — | — |

Cross-cutting requirements: ecosystem inventory ✅; dependency map ✅; root-cause register ✅; central reliability view ◐ (Memory `/reliability` covers storage SLAs; Central health page covers Mines; no single page covers all platforms); autonomous recovery ◐ (outbox replay and Guardian runbooks exist; Guardian is recommend-only by design); failure testing ◌; SLOs ◐ (proposed, not agreed).

## 11. Recommended next actions, in order

1. **Merge and deploy the four probe PRs one at a time** (Memory #12 → Dopemine #6 → Charts #5 → Doc #24, the last deploys on merge), reading the crontab line after each; confirm `/up/scheduler` turns 200 within two minutes and the first watchdog run is green.
2. **Dot.Files**: rebuild the route cache on the host, then give the repo the bootstrap/deploy/server-logs trio (it already has committed `public/build`). Until then the health endpoint discloses paths.
3. **Dot.Agents**: merge #4; before the first automated deploy, reconcile what is on the host with `origin/main` (the local checkout at `~/Dot/Dot.Agents` also holds two unpushed commits) and run `deploy.yml` with a rollback plan.
4. **Backups** for Memory, Dopemine, Doc, Charts (port Central's `BackupSqliteDatabase`), ideally copied off-host.
5. **Guardian enrollment** for Central, Memory, Dopemine, Doc, Charts via `dot-guardian/v1` health documents and collector manifests; then a single ecosystem page (in Dot.Central or Dot.Memory) reading the collector's hourly records once Memory exposes per-check detail (ADR-0019 open question).
6. Close/patch the three stale Memory incidents; rotate both Guardian PATs before 2026-11-20; fix the shared registry URLs and active flags; set `APP_NAME` on Charts and Engage.
7. Decide the realtime story for shared hosting (hosted broadcaster or remove live affordances) for Mines, Engage and Projects.

## 12. Rollout update, 2026-10-17 05:00 UTC

Written after the fixes in §3 and §11 were merged, deployed and re-measured. Everything below was observed, not assumed; each line names where.

### 12.1 What is now true

| Item | Evidence |
|---|---|
| `/up/scheduler` answers 200 on Memory, Dopemine, Charts, Central and Doc. Doc also reports the queue worker. | `curl` at 04:07 and again after each deploy; Doc waited for its first queue heartbeat (about five minutes) before turning 200. |
| Each of those five deploys kept the shared crontab whole: 1 + 8 lines, Central 2 + 7. | `== crontab: ...` line of every deploy log. |
| A GitHub watchdog asks each probe every 15 minutes and now retries three times before failing. | Central's watchdog failed once at 03:19 on an HTTP 403 from the host firewall while the scheduler was fine (run 38998363371); fix merged in Memory #16, Dopemine #9, Charts #8, Central #14, and carried by the Doc stack. |
| The Guardian polls six platforms, all reachable and healthy, no incidents. The hourly collector fetches the same six (dry run). | Guardian run 39003772656 on Dot.Brain main 1f47fd7; collector dry run 39003808534. |
| Authenticated `/guardian/health` reports are healthy on Central (7 checks incl. Mines sync and Memory outbox), Memory (5, incl. intelligence ingest), Dopemine, Charts and Doc (queue). A wrong token answers 401; no token configured answers 503. | `curl` with the local token files, 04:30 to 04:50. |
| Nightly SQLite backups are in code and deployed for Memory (02:20), Dopemine (02:25), Charts (02:30) and Doc (02:35), beside Central (02:15). | Merged and deployed; **first run not yet observed**. Verify with each repo's `server-logs.yml` "Backup evidence" step after 02:35 tomorrow (Doc has no server-logs workflow). |
| Dot.Charts API: `GET /api/me` without an Accept header was a **500** (no `login` route for the default guest redirect) and an invalid `POST /api/backtests` was a 302. Both now return JSON (401, 422). | Reproduced live, fixed in Dot.Charts #10, re-measured live after the deploy. |
| InfoDot CI is green on main for the first time since 2026-08-07. | InfoDot #2, run on main at 22:59. |

### 12.2 Corrections to the status matrix in §10

| Platform | Was | Now |
|---|---|---|
| Memory, Dopemine, Charts, Doc | probe and watchdog "Partially implemented", Guardian "no" | probe ✅, watchdog ✅, Guardian ✅ enrolled and healthy, backups ◐ (deployed, first run unobserved) |
| Central | Guardian "no" | Guardian ✅ enrolled and healthy |
| InfoDot | test gate "Partially implemented" | test gate ✅ |
| Dot.Charts | no entry | API error contract ✅ fixed |

### 12.3 Still open

| Item | Why it is not done |
|---|---|
| Dot.Files `/up` answers 500 and prints server paths | Dot.Files #80 adds the adopt, deploy and logs workflows. It needs five `DEPLOY_*` repository secrets and the owner to run the one-time adoption. |
| Dot.Agents deploy has never succeeded | Dot.Agents #4 clears its advisories and CI is green. Merging triggers the first automated deploy to a live site whose provenance is unknown, so it waits for an owner decision. |
| Guardian cannot open GitHub issues on the five new repositories | `GUARDIAN_GH_TOKEN` is scoped to Dot.Mines. The Guardian catches that per incident, so polls and Memory archiving are unaffected. Extend the token to the five repositories before the first real incident there. |
| No off-host copy of any backup | The copies sit beside the live SQLite files on the same host. |
| Dot.docs requires a review that the owner removes before each merge | The rule was removed on 2026-10-17 to merge #24, #25 and #26 and must be re-enabled. |
| Dependency advisories | Dot.Central #13 clears composer; npm still fails in Central and Doc on `braces` (no patched release; Tailwind v3 tree). |
| Realtime on shared hosting, stale open Memory incidents, registry URLs, `APP_NAME` on Charts and Engage | Unchanged from §7. |
| Failure simulations and staging | Still none. |

## 13. Findings from the Dot.Agents inspection and a ten-host probe, 2026-10-17 06:00 UTC

### 13.1 Corrections to the inventory in §1

| Earlier statement | What is true |
|---|---|
| "Dot.Press and Dot.Sheet: no DNS record (development only)" | **Both are live.** The hostnames are `pres.infodot.co.za` (Laravel, session cookie `laravel_session`, so no `APP_NAME` set) and `sheets.infodot.co.za` (Dot.Sheets, `dotsheets-session`). Both are on 198.38.92.233 and answer `/up` 200. My first sweep guessed `press` and `sheet`. |
| "Live without a pipeline: InfoDot, Files, Forms, Projects, Engage" | Add **Dot.Agents, Dot.Press and Dot.Sheet**. Dot.Files has had a pipeline since 2026-10-17 (adopted, deployed). |
| "The shared registry marks only Charts inactive" | Unchanged, but the registry also still points at `infodot.app`. |
| Home directory entries on the host | `control.infodot.co.za` (no DNS), `docs.infodot.co.za` (resolves to 198.244.229.148, a different server, no answer) and `charts-static-clone-backup` exist. Not investigated further. |

### 13.2 New defect D9: eight live hosts serve full debug error pages to anyone

A `POST` to `/up` (a GET-only route, so a harmless 405 that never reaches a controller) returns:

| Host | Response | Host | Response |
|---|---|---|---|
| mines, central, memory, charts, dopemine | 1 KB plain 405 | doc, agents, files, forms, projects, engage, pres, sheets | **about 840 KB debug page, 65 to 71 stack frames, server paths** |

Cause: `APP_DEBUG=true` in the production `.env` (confirmed for Dot.Agents by the inspect run; inferred for the rest from identical behaviour). Counting patterns in the pages (no content printed) found **no application key, API key, token or `DB_`/`MAIL_` value**; they leak source code, framework internals and home-directory paths. Impact: information disclosure that helps an attacker, not a credential leak. Fix: `APP_DEBUG=false` and `config:cache` on each host; nothing else is needed. Not fixed at the time of writing.

### 13.3 Dot.Agents: how it actually runs

Read-only inspect run 39005614928 (`server-inspect.yml`, Dot.Agents #5):

| Fact | Value |
|---|---|
| Location | `/home/<account>/agents.infodot.co.za/agents`, same account as the other Dot apps |
| Deployed how | **Not a git checkout.** Uploaded or unpacked; directory last changed 11 June. Installed `laravel/framework` is 12.61.1, months older than `main` |
| Drivers | `DB_CONNECTION=sqlite`, `QUEUE_CONNECTION=database`, `CACHE_STORE=database`, `SESSION_DRIVER=database`, `BROADCAST_CONNECTION=log`, `MAIL_MAILER=smtp`. `REDIS_*` keys exist but nothing uses Redis |
| `APP_DEBUG` | **true** (see D9) |
| Cron | **No cron line for Dot.Agents.** Nothing runs `schedule:run` or a queue worker, so its 5 scheduled tasks and its queued jobs (70 job classes) are not being processed. Backlog size not yet measured |
| Host | PHP 8.4.26 CLI; `pdo_sqlite`, `pdo_pgsql`, `pdo_mysql`, `redis` extensions present; no Horizon, Reverb or supervisor process |

Conclusion: production already runs the **shared-host profile** (Option A in the Dot.Agents recommendation), without the cron lines or deploy discipline the other apps have. The VPS pipeline in the 2026-09-19 audit (Dot.Agents #6) does not apply.

## 14. Pipeline rollout to five more apps, and what it found, 2026-10-17 (probe at 07:52 UTC)

Written after Projects, Forms, Engage, Press and Sheet were each taken over by a pipeline and deployed. This section supersedes the parts of §12.3 and §13 that it names. Everything below was observed in a run log, a command output or a live request.

### 14.1 What is now true

| Item | Evidence |
|---|---|
| **D9 is closed on all thirteen live hosts.** `POST /up` answers a 1 KB 405, `GET /up` answers 200, on mines, central, memory, charts, dopemine, doc, agents, files, forms, projects, engage, pres and sheets. | One `curl` sweep at 07:52 UTC. The pipelines also force `APP_DEBUG=false` on every deploy. |
| Projects, Forms, Engage, Press and Sheet each run on `main` through a manual, gated pipeline: test gate, drift report, adopt once, deploy, smoke check, cron lines through the shared locked crontab block. | Projects #4 (f3e4109, adopt run 39010753794). Forms #3, #4, #5 (f0f71f3, adopt run 39012186438, deploy 39012377893). Engage #3 (6d51572, adopt 39013061354, deploy 39013233773). Press #3 (1a071bf, adopt 39013952754, deploy 39014372906). Sheet #3 (a922456, adopt 39014808591, deploy 39015027734). |
| Dot.Projects login was a 500 and is now 200. The unused database was rebuilt with a guarded `migrate:fresh` (0 users, 0 projects checked first); 11 migrations ran. | Owner's cPanel output after the reset; `/login`, `/register`, `/forgot-password` return 200. |
| Forms, Engage, Press and Sheet applied their pending migrations after a rollback copy and, for the database, an owner-made backup. | The "Running migrations" block of each deploy log: Forms 2, Engage 9, Press 7, Sheet 13, all DONE. |
| The shared crontab grew from 9 to 17 lines without losing a line. | `== crontab: ... other line(s) preserved` in each log: 9, 10, 12, 14, 16 preserved. |

### 14.2 Defects the rollout found (all fixed in the pipelines before they cost data)

| Id | Defect | Evidence and fix |
|---|---|---|
| D10 | **Create-table migrations renamed to fix an ordering bug fail on a live database that recorded the old names** ("table already exists"), after maintenance mode has started. Hit Forms (1 table), Engage (3), Press (3), Sheet (3). | Reproduced on a production-like SQLite database in every repo: fails without the change, passes with it. Each renamed migration now returns early when its table exists (Forms #4, Engage #3, Press #3, Sheet #3). Owner's `migrate:status` on Engage and Press showed the old names recorded. |
| D11 | **Host git hooks can abort a release.** Forms' old checkout carried a Git LFS `post-checkout` hook with no `git-lfs` installed, so `git checkout` exited non-zero after maintenance mode started. Engage's host has four such hooks. | Forms adopt run 39011933736 left forms.infodot.co.za returning 503 for about four minutes (07:00:29 to 07:04:35 UTC) until the re-run. Fix: release git commands run with `core.hooksPath=/dev/null` (Forms #5, and in Engage, Press and Sheet). Reproduced on a fake host. |
| D12 | **Adopt refused any folder that already had `.git`**, but the Forms and Engage hosts are checkouts of their own unpushed history. | Adopt now keeps that history on a local `host-before-adopt-*` branch, points `origin` at the real repository and resets to `main`. Engage's old remote was a different GitHub account. Tested on a fake host. |
| D13 | **A drift report that cannot find the host would have said "no drift".** | Found by testing; the report now refuses a missing or empty file list (fixed before the first rollout). |

### 14.3 Still open after the rollout

| Item | Why it is not done |
|---|---|
| Review rules on Forms, Engage, Projects, Press and Sheet are off | The owner removed them to merge the pipeline pull requests. They must be re-enabled. Dot.docs and Dot.Files were handled the same way earlier. |
| Logged-in flows on the five apps are untested | Only public pages, assets and the debug probe were checked by request. |
| No nightly backup for Forms, Engage, Projects, Press or Sheet | Press is SQLite in the app folder and Central's backup could be ported. Engage's and Forms' database types are not confirmed here. Rollback copies cover code only, and SQLite when the file is inside the app folder. |
| No Guardian health document, watchdog or backup for the five | Not built. `GUARDIAN_GH_TOKEN` also still needs the five repositories. |
| Engage: six view files the old host had edited were replaced by `main` | The edits were uncommitted, so they exist only in the adopt rollback copy (`dot-engage-adopt-20261017T071803Z.tgz`). |
| Dot.Agents has no cron and no decided pipeline | Unchanged from §13.3. |
| The one-off `set-app-debug` pull requests (#2) in the five repositories | Superseded by the pipelines; not closed. |
