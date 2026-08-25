# Dot Guardian — Autonomous Monitoring & Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Dot.Mines a 24/7 production guardian: machine-readable health signals on the platform, a platform-agnostic detection/decision/remediation orchestrator in Dot.Brain, and long-term incident memory in Dot.Memory — deploying fixes only through the existing GitHub Actions CI/CD pipeline under progressive-autonomy safety controls.

**Architecture:** Three cooperating pieces. (1) **Dot.Mines Guardian health layer** — a token-authenticated `GET /guardian/health` endpoint backed by `app/Services/Guardian/*` checks (db, cache, queue, scheduler heartbeat, error rate, integration sync recency, telemetry/production ingestion), each returning `healthy|warning|critical|unknown`. (2) **Dot.Brain `services/guardian`** — a zero-dependency Node 22 service (matching `services/intervention-log` conventions) that polls any platform implementing the contract (registry-driven manifests in `platforms/guardian/*.json`), opens/dedupes incidents in sqlite, runs a structured decision engine (severity × confidence × risk × autonomy level), executes safe runbook remediations via the `gh` CLI against the platform's own repo and deploy workflow, verifies post-deploy health, rolls back on failed verification, and escalates after bounded attempts. (3) **Dot.Memory ops-memory API** — Sanctum-token endpoints storing incident records and recalling prior incidents/fixes by error signature so the decision engine gains historical confidence.

**Tech Stack:** Laravel 12 / PHP 8.5 / PHPUnit (mines, Dot.Memory); Node ≥22.5 ESM, `node:sqlite`, `node --test`, zero npm deps (Dot.Brain); GitHub CLI (`gh`) for branch/PR/CI/deploy operations.

## Global Constraints

- Existing Dot.Mines CI/CD (`.github/workflows/deploy.yml`, manual `workflow_dispatch` with `confirm: deploy`) remains the ONLY deployment mechanism. The guardian triggers it; it never deploys another way.
- Dot.Brain never edits platform-owned files directly in production; remediation lands as branches/PRs in the platform repo (manifesto rule 4).
- Mines code must obey `.ai/rules` (ApiResponse envelopes are irrelevant here — guardian endpoint lives in `routes/web.php` like `/health` and `/up/realtime`, NOT in `routes/api_v1.php`, so it stays outside the OpenAPI/token-ability machinery and never exposes operational internals on the public API surface).
- Mines: phpstan (level max) + psalm (errorLevel 1) run bare — new code must pass with no baseline. Run `vendor/bin/pint --dirty --format agent` after PHP edits. PHPUnit only (no Pest).
- Dot.Brain services: `"type": "module"`, `engines.node >=22.5.0`, no runtime npm dependencies, tests via `node --experimental-sqlite --test`, CLI via `src/cli.js` bin.
- Severity vocabulary aligns with `schemas/incident.schema.json`: `sev1..sev4`.
- Health status vocabulary (the cross-platform contract): `healthy | warning | critical | unknown`.
- No secrets in source control anywhere. Tokens come from env (`GUARDIAN_TOKEN`, `DOT_MEMORY_TOKEN`, `GH_TOKEN`).
- Autonomy levels: L1 observe, L2 recommend (PR, no merge), L3 controlled auto-fix (runbook/known fixes only, auto-merge+deploy when CI green), L4 human approval always (auth/billing/schema/data-deletion/tenant-isolation paths). Protected areas force L4 regardless of manifest level.
- Loop guards: max 2 fix attempts per incident, max 3 guardian-triggered deploys per platform per 6h, circuit breaker opens after 2 consecutive failed verifications and requires human reset.

---

### Task 1: Dot.Mines guardian config, token middleware, and endpoint skeleton

**Files:**
- Create: `mines/config/guardian.php`
- Create: `mines/app/Http/Middleware/AuthenticateGuardian.php`
- Create: `mines/app/Http/Controllers/GuardianHealthController.php`
- Create: `mines/app/Services/Guardian/CheckResult.php`, `mines/app/Services/Guardian/Contracts/GuardianCheck.php`
- Modify: `mines/routes/web.php` (register route next to `/health`), `mines/bootstrap/app.php` (middleware alias `guardian.token`)
- Test: `mines/tests/Feature/Guardian/GuardianEndpointTest.php`

**Interfaces:**
- Produces: `GuardianCheck` interface — `public function key(): string; public function run(): CheckResult;`
- Produces: `CheckResult` value object — `CheckResult::healthy(string $message = '', array $metrics = [])`, `::warning(...)`, `::critical(...)`, `::unknown(...)`; `status(): string`, `toArray(): array{status:string,message:string,metrics:array<string,mixed>}`
- Produces: `GET /guardian/health` (middleware `guardian.token`) → 200 JSON `{platform:"dot-mines", contract:"dot-guardian/v1", generated_at, status:<worst-of-checks>, checks:{<key>:{status,message,metrics}}}`; overall status is worst across checks with ordering unknown<warning<critical (healthy lowest). HTTP status is 200 even when degraded — the *body* is the signal (Brain must distinguish "endpoint down" from "checks failing").
- Auth: `Authorization: Bearer <GUARDIAN_TOKEN>` compared with `hash_equals`; 401 otherwise; 503 `unknown` if no token configured.

Steps: write failing endpoint test (auth 401, happy path shape, worst-status aggregation with a fake check bound in the container) → implement → `php artisan test --compact tests/Feature/Guardian/GuardianEndpointTest.php` → pint → commit on branch `guardian/health-layer`.

### Task 2: Core infrastructure checks (database, cache, queue, scheduler heartbeat)

**Files:**
- Create: `mines/app/Services/Guardian/Checks/DatabaseCheck.php`, `CacheCheck.php`, `QueueCheck.php`, `SchedulerCheck.php`
- Modify: `mines/routes/console.php` (everyMinute heartbeat: `Cache::put('guardian:scheduler-heartbeat', now()->toISOString(), 600)` via named closure task), `GuardianHealthController` check registry
- Test: `mines/tests/Feature/Guardian/CoreChecksTest.php`

**Interfaces:**
- QueueCheck metrics: `pending_jobs`, `oldest_pending_seconds`, `failed_last_hour` from `jobs`/`failed_jobs` tables. Thresholds from `config/guardian.php` (`queue.pending_warning:100, pending_critical:500, oldest_warning_s:300, oldest_critical_s:900, failed_warning:5, failed_critical:20`).
- SchedulerCheck: heartbeat age >5m warning, >15m critical, missing → unknown.

Steps: failing tests simulating each state (insert stale jobs rows, failed_jobs rows, manipulate heartbeat cache key) → implement → run → pint → commit.

### Task 3: Application-error-rate check via exception counter

**Files:**
- Create: `mines/app/Services/Guardian/ErrorCounter.php`, `mines/app/Services/Guardian/Checks/ErrorRateCheck.php`
- Modify: `mines/bootstrap/app.php` `withExceptions` → `$exceptions->report(fn (Throwable $e) => app(ErrorCounter::class)->record($e));` (non-throwing; wrap in try/catch)
- Test: `mines/tests/Feature/Guardian/ErrorRateCheckTest.php`

**Interfaces:**
- `ErrorCounter::record(Throwable $e): void` — increments cache key `guardian:errors:<Y-m-d-H>` (TTL 2h) and stores last error class+message in `guardian:errors:last`.
- `ErrorRateCheck` metrics: `errors_this_hour`, `errors_prev_hour`, `last_error`. Thresholds `errors.warning:10, errors.critical:50` per hour.

### Task 4: Integration sync, telemetry ingestion, and production freshness checks

**Files:**
- Create: `mines/app/Services/Guardian/Checks/IntegrationSyncCheck.php`, `TelemetryIngestionCheck.php`, `ProductionFreshnessCheck.php`
- Test: `mines/tests/Feature/Guardian/DataHealthChecksTest.php` (uses existing Integration/Machine/MachineMetric factories)

**Interfaces:**
- IntegrationSyncCheck: for every `Integration` with `status='active'`, compare each `sync_streams` stream's `last_synced_at` (and integration-level last sync) against the integration's configured interval: >2× overdue → warning, >4× → critical; any stream `status='failed'` → warning (critical if all failed). `unknown` when no active integrations. Metrics list per-integration lag. **This is the "page loads but production data stopped updating" detector.**
- TelemetryIngestionCheck: newest `MachineMetric` age across teams that have active integrations; >2× the largest sync interval → warning, >4× → critical; `unknown` when no active integrations/machines.
- ProductionFreshnessCheck: newest load/payload-bearing metric (production counters) age vs same thresholds — detects telemetry flowing but production counters frozen.
- Implementer note: read `app/Models/Integration.php`, `app/Models/MachineMetric.php`, and `app/Services/Integration/IntegrationService.php` first for exact column names; use existing factories.

### Task 5: Dot.Memory ops-memory API (incident store + recall)

**Files:**
- Create: `Dot.Memory/database/migrations/2026_08_25_100000_create_ops_incidents_table.php`
- Create: `Dot.Memory/app/Models/OpsIncident.php` (+ factory `database/factories/OpsIncidentFactory.php`)
- Create: `Dot.Memory/app/Http/Controllers/Ops/OpsIncidentController.php`
- Modify: `Dot.Memory/routes/api.php`
- Test: `Dot.Memory/tests/Feature/OpsIncidentApiTest.php`

**Interfaces (consumed by Task 8 memory client):**
- Table: `id`, `incident_uid` (string unique), `platform`, `environment`, `detection_source`, `signature` (indexed), `component`, `severity` (sev1..sev4), `status` (open|remediating|resolved|escalated|rolled_back), `diagnosis` text nullable, `actions` json nullable, `code_changes` json nullable (e.g. `{branch,pr_url,commits:[]}`), `tests_result`/`deploy_result`/`validation_result`/`rollback_status` strings nullable, `resolution` text nullable, `detected_at` datetime, `resolved_at` nullable, timestamps.
- Routes (all `auth:sanctum`):
  - `POST /api/ops/incidents` → 201, creates from JSON body (validated; `incident_uid` idempotent-upserts).
  - `PATCH /api/ops/incidents/{incident_uid}` → 200, partial update.
  - `GET /api/ops/incidents?platform=&signature=&status=&limit=` → 200 `{data:[...]}` newest-first.
  - `GET /api/ops/recall?platform=&signature=` → 200 `{data:{matches:<int>, resolved:<int>, rolled_back:<int>, success_rate:<float|null>, last_successful_fix:<incident|null>, incidents:[last 10]}}` — the decision-engine's history answer.
- Service auth: seed nothing; docs say create a service user + `php artisan tinker` personal access token; tests use `Sanctum::actingAs`.

### Task 6: Dot.Brain guardian service — store, registry, health client, detection

**Files:**
- Create: `Dot.Brain/services/guardian/package.json` (`@dot-brain/guardian`, bin `guardian`, test script `node --experimental-sqlite --test`)
- Create: `Dot.Brain/services/guardian/src/store.js`, `src/registry.js`, `src/health.js`, `src/detect.js`
- Create: `Dot.Brain/platforms/guardian/dot-mines.json`
- Test: `Dot.Brain/services/guardian/test/detect.test.js`, `test/registry.test.js`

**Interfaces:**
- Manifest `platforms/guardian/<platform>.json`: `{platform, health_url, token_env, repo:"sakhilebhayi/Dot.Mines", default_branch:"main", deploy:{workflow:"deploy.yml", confirm_input:{confirm:"deploy"}}, autonomy_level:1..4, poll_interval_s, max_fix_attempts:2, max_deploys_per_6h:3, protected_areas:["app/Http/Middleware/Auth*","database/migrations/**","app/Services/Billing/**","config/fortify.php","app/Policies/**"], verification:{polls:5, interval_s:60}}`
- `registry.loadManifests(dir)` → validated array (throws on missing required keys).
- `health.fetchHealth(manifest, fetchImpl)` → normalized `{reachable, status, checks}`; network failure/timeout/non-200 → `{reachable:false}` which detection treats as a critical `availability` check.
- `store.openStore(dbPath)` → sqlite with tables `incidents` (id, incident_uid, platform, signature, check_key, severity, status, first_seen, last_seen, attempts, detail json), `deployments`, `breaker` (platform, state open|closed, opened_at, reason), `memory_outbox` (queued Dot.Memory writes).
- `detect.reconcile(store, platform, healthDoc, now)` → `{opened:[], ongoing:[], resolved:[]}`; signature = `platform:check_key:critical|warning`; warning→critical on same check updates severity, keeps incident; healthy check with open incident → resolved. Severity map: availability/database critical→sev1; other critical→sev2; warning→sev3.

### Task 7: Decision engine + loop guards

**Files:**
- Create: `Dot.Brain/services/guardian/src/decide.js`
- Test: `Dot.Brain/services/guardian/test/decide.test.js`

**Interfaces:**
- `decide.evaluate({incident, manifest, recall, breakerOpen, deploysLast6h})` → `{action:"observe"|"recommend"|"auto_remediate"|"escalate", runbook:<key|null>, confidence:0..1, risk:0..1, reasons:[strings]}` — pure function, fully unit-testable.
- Rules (explicit, in order): breaker open → escalate. attempts ≥ max_fix_attempts → escalate. sev1 availability/database → observe+escalate (infra issues are not code-fixable). Autonomy L1 → observe. Runbook lookup by check_key (Task 8 registry); none → recommend (L≥2) or observe. Protected-area runbooks → never auto (recommend). Confidence = base 0.5 + 0.3 if recall.success_rate ≥ 0.8 with ≥2 matches, − 0.2 if recall.rolled_back > 0 recently. Risk from runbook's declared risk (low 0.2/medium 0.5/high 0.8). auto_remediate only when L≥3 ∧ confidence ≥ 0.6 ∧ risk ≤ 0.4 ∧ deploysLast6h < max.
- Tests cover every rule branch (table-driven).

### Task 8: Memory client, runbook registry, GitHub remediation, verification, escalation

**Files:**
- Create: `Dot.Brain/services/guardian/src/memory-client.js`, `src/runbooks.js`, `src/remediate.js`, `src/verify.js`, `src/escalate.js`
- Test: `test/memory-client.test.js`, `test/remediate.test.js`, `test/verify.test.js`

**Interfaces:**
- `memory-client.record(cfg, incidentRecord, fetchImpl)` / `.recall(cfg, {platform,signature}, fetchImpl)`; on failure, writes to `memory_outbox`; `flush(cfg, store, fetchImpl)` retries. cfg from env `DOT_MEMORY_URL`, `DOT_MEMORY_TOKEN`. Recall failure → `{matches:0}` (never blocks detection).
- `runbooks.forCheck(check_key)` → e.g. `integration_sync`→`retrigger_sync` (risk low; runs repo workflow or documented artisan via deploy host is NOT available — instead: open PR only if code change needed; primary action `redeploy` covers queue:restart+config recache), `queue`→`redeploy` (low), `scheduler`→`redeploy` (low), `error_rate` after deploy correlation→`rollback_last_deploy` (medium), default→`null`. Each: `{key, risk, kind:"workflow"|"revert_pr"|"issue"}`.
- `remediate.execute({incident, decision, manifest, store, gh})` where `gh` is an injected exec wrapper (tests fake it):
  - `workflow` kind → `gh workflow run <wf> -R <repo> -f confirm=deploy`, record deployment.
  - `revert_pr` kind → find last guardian-or-any merge commit via `gh api`, `gh api` create branch `guardian/incident-<uid>`, revert commit, open PR with diagnostic body (incident JSON, health excerpt, memory recall summary), watch `gh pr checks`; merge only if decision.action==="auto_remediate"; then trigger deploy workflow.
  - L2 (`recommend`) → same PR, never merge; adds `needs-human-approval` label.
- `verify.postDeploy({manifest, store, incident, fetchImpl, sleepImpl})` → polls health `verification.polls` times; returns `{ok}`; failure increments breaker (2 consecutive → open) and triggers `rollback_last_deploy` once, then escalate.
- `escalate.raise({incident, manifest, gh, reason})` → opens GitHub issue on platform repo titled `[guardian] <severity> <signature>` with full context; records in store; also appends to `services/intervention-log` db via its exported `openLog`/`record` (entity = platform).

### Task 9: CLI, watcher, dashboard report, service README + ADR

**Files:**
- Create: `Dot.Brain/services/guardian/src/cli.js` (`poll [--platform]`, `watch`, `status`, `incidents`, `remediate <uid>`, `flush-memory`, `report`), `src/report.js`
- Create: `Dot.Brain/services/guardian/README.md` (contract doc: health JSON shape, manifest schema, autonomy levels, safety guards, how to enroll a new platform in <10 lines of JSON)
- Create: `Dot.Brain/adr/ADR-<next>-dot-guardian-architecture.md`
- Test: `test/report.test.js`, `test/cli.test.js` (status/poll happy path with mock server)

**Interfaces:**
- `poll` = fetch → detect → for each opened/ongoing: recall → decide → (observe: record only | recommend/auto: remediate | escalate) → record to memory. Exit code 0 healthy, 1 active incidents.
- `report` writes `services/guardian/dashboard/index.html`: current status per platform, active/resolved incidents, attempts, rollbacks, pending approvals (open PRs w/ label), MTTD/MTTR, auto-fix success rate, top recurring signatures. Static self-contained HTML from sqlite.

### Task 10: End-to-end failure-scenario suite + full test runs

**Files:**
- Create: `Dot.Brain/services/guardian/test/e2e-scenarios.test.js`
- Run: mines + Dot.Memory + guardian full suites

**Scenarios (mock health server + fake gh, per spec §15):** database down → sev1 escalate no code change; Bell sync stale → incident, recall known fix, L3 auto path calls deploy workflow + verifies + resolves; ingestion stopped at L2 → PR recommended, no merge; broken deploy → verification fails → rollback PR + escalate; repeat failure → attempts cap → breaker opens → next poll escalates immediately; duplicate detection → one incident, attempts unchanged; Dot.Memory down → outbox queues and flushes.

Final steps: `php artisan test --compact` in mines (guardian dir + touched files), pint, phpstan/psalm on changed files; `php artisan test --compact` in Dot.Memory; `npm test` in guardian; verify existing mines suites still pass.

---

## Self-Review Notes

- Spec §1 covered by inspection (recorded above plan); §2–3 Tasks 1–4; §4 Tasks 6–9; §5 Task 5+8; §6 Task 9 poll pipeline; §7 constraints + Task 7; §8 Task 8; §9 Task 8 verify + existing atomic-ish deploy; §10 Task 7 guards + Task 10; §11 Task 7; §12 Task 9 report; §13 manifests/registry (Task 6); §14 bearer tokens, env-only secrets, least-priv gh; §15 Task 10; §16 deploy workflow reuse; §17 ordering of tasks.
- Deliberate scope call: "AI writes a novel code patch" is NOT auto-executed at any level — novel fixes surface as escalation issues/PR requests for a coding agent or human; only runbook/previously-validated actions run autonomously. This is the safe interpretation of Level 3.
