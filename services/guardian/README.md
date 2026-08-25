# Dot Guardian

The Dot ecosystem's autonomous production guardian. It polls each enrolled
platform's `dot-guardian/v1` health endpoint, opens and dedupes incidents,
recalls history from Dot.Memory, decides what it may do inside explicit
progressive-autonomy boundaries, remediates only through the platform's own
GitHub repo and existing CI/CD workflow, verifies after every deploy, rolls
back its own failed changes, and escalates to a human the moment its
guardrails say stop. See [ADR-0014](../../adr/ADR-0014-dot-guardian-architecture.md)
for the architecture decision and `brain.resilience.md` for the doctrine it
implements.

Dot.Mines is the first enrolled platform
([`platforms/guardian/dot-mines.json`](../../platforms/guardian/dot-mines.json)).
Enrolling another platform is one manifest file plus a health endpoint on the
platform — never an architecture change.

## The lifecycle

```text
Platform production health (/guardian/health)
        │  poll
        ▼
Detect ──► one active incident per failing check (dedupe, severity upgrade)
        ▼
Dot.Memory recall  ──  "seen this signature before? did the fix stick?"
        ▼
Decision engine  ──  severity × confidence × risk × autonomy level
        ▼
observe │ recommend (GitHub issue) │ auto-remediate (runbook via CI/CD) │ escalate
        ▼
Post-deploy verification (health polls)
        ▼
ok → resolve + record        failed → rollback own change, attempt counter,
      to Dot.Memory                    circuit breaker, escalate to human
```

## The platform contract (`dot-guardian/v1`)

A platform enrolls by serving an authenticated, machine-readable health
report:

```
GET /guardian/health
Authorization: Bearer <token>

{
  "platform": "dot-mines",
  "contract": "dot-guardian/v1",
  "generated_at": "2026-08-25T18:00:00Z",
  "status": "critical",              // worst of all checks
  "checks": {
    "database":            {"status": "healthy",  "message": "...", "metrics": {}},
    "queue":               {"status": "healthy",  "message": "...", "metrics": {"pending_jobs": 3}},
    "scheduler":           {"status": "healthy",  "message": "...", "metrics": {}},
    "error_rate":          {"status": "healthy",  "message": "...", "metrics": {}},
    "integration_sync":    {"status": "critical", "message": "...", "metrics": {}},
    "telemetry_ingestion": {"status": "warning",  "message": "...", "metrics": {}},
    "production_freshness": {"status": "healthy", "message": "...", "metrics": {}}
  }
}
```

Rules:

- Status vocabulary is exactly `healthy | warning | critical | unknown`.
  `unknown` means "no signal", and the guardian treats it as neither proof
  of health nor of failure.
- The endpoint answers **HTTP 200 even when degraded** — the body is the
  signal. An unreachable endpoint is itself a critical `availability`
  incident (sev1).
- Check keys are the platform's own; the runbook registry maps known keys
  (`queue`, `integration_sync`, `telemetry_ingestion`,
  `production_freshness`, `error_rate`) to safe actions, and every other
  key simply flows to recommend/escalate.
- The endpoint must be token-authenticated (it exposes operational
  internals) and fail closed when no token is configured.

## The manifest (`platforms/guardian/<platform>.json`)

```json
{
  "platform": "dot-mines",
  "health_url": "https://mines.infodot.co.za/guardian/health",
  "token_env": "DOT_MINES_GUARDIAN_TOKEN",
  "repo": "sakhilebhayi/Dot.Mines",
  "default_branch": "main",
  "deploy": { "workflow": "deploy.yml", "confirm_inputs": { "confirm": "deploy" } },
  "autonomy_level": 2,
  "poll_interval_s": 300,
  "max_fix_attempts": 2,
  "max_deploys_per_6h": 3,
  "protected_areas": ["database/migrations/**", "app/Policies/**"],
  "verification": { "polls": 5, "interval_s": 60 }
}
```

The platform's existing CI/CD workflow is the **only** deployment
mechanism the guardian knows. It triggers `deploy.workflow` via
`gh workflow run` with the declared confirm inputs; it never ssh-es, never
edits production, never builds a parallel pipeline.

## Progressive autonomy

| Level | Meaning | Guardian may |
| --- | --- | --- |
| 1 | Observe | poll, open incidents, record to Dot.Memory |
| 2 | Recommend | + open a diagnosis/proposal issue on the platform repo |
| 3 | Controlled autonomous fix | + execute low-risk runbooks through CI/CD, verify, roll back |
| 4 | Critical intervention | reserved; guardian still requires human approval for protected areas |

Hard rules enforced by the decision engine (`src/decide.js`), all
unit-tested:

- sev1 (platform/database unreachable) always escalates — infrastructure is
  not code-fixable from GitHub.
- Autonomous action requires level ≥ 3 **and** confidence ≥ 0.6 **and**
  risk ≤ 0.4 **and** deploy budget available (`max_deploys_per_6h`).
- Confidence starts at 0.5 and only crosses the floor with Dot.Memory
  history (≥ 2 prior matches at ≥ 80% success). Prior rollbacks subtract.
- `max_fix_attempts` (default 2) per incident; then escalate.
- Two consecutive failed post-deploy verifications open the platform's
  circuit breaker; every decision escalates until a human runs
  `guardian reset-breaker <platform>`.
- Novel code fixes are **never** written autonomously: an unmatched check
  key produces a recommendation/escalation for a human (or an explicitly
  invoked coding agent), whose validated fix then becomes recallable
  history in Dot.Memory.

## Usage

```bash
cd services/guardian
npm test                      # 48 tests incl. end-to-end failure scenarios

export DOT_MINES_GUARDIAN_TOKEN=...   # per-manifest platform token
export DOT_MEMORY_URL=https://memory.infodot.app
export DOT_MEMORY_TOKEN=...           # Sanctum PAT for the guardian service user
export GH_TOKEN=...                   # least-privilege: repo + workflow on enrolled repos

node src/cli.js poll          # one detect/decide/act cycle (exit 1 if incidents active)
node src/cli.js watch         # continuous, per-manifest poll_interval_s
node src/cli.js status        # active incidents + breaker per platform
node src/cli.js report        # writes dashboard/index.html
node src/cli.js reset-breaker dot-mines
node src/cli.js flush-memory  # retry queued Dot.Memory writes
```

State lives in `services/guardian/data/guardian.sqlite` (override with
`GUARDIAN_DB`). The dashboard is a self-contained HTML file — no CDN, no
external requests.

## Security posture

- One bearer token per platform health endpoint, injected via env
  (`token_env`), never committed.
- Dot.Memory access via a dedicated Sanctum service-account token.
- GitHub access via `gh` with a token scoped to the enrolled repos only;
  merges happen exclusively through `gh pr merge` after `gh pr checks`
  reports green — CI stays the gatekeeper.
- Every action is auditable: incidents, deployments, escalations, and the
  memory outbox are all rows in the sqlite store, and every incident is
  mirrored to Dot.Memory's ops archive (envelope queryable, narrative
  encrypted at rest).

## Verified failure scenarios (`test/e2e-scenarios.test.js`)

Database down · integration sync stale (auto-fix path) · ingestion stopped
(recommend path) · broken deploy → failed verification → rollback →
breaker → escalation · Dot.Memory outage (outbox + flush) · self-recovery.
Per plan §15, `platforms/guardian/dot-mines.json` stays at
`autonomy_level: 2` until these scenarios have also been exercised against
the real staging environment; the registry test enforces the ceiling.
