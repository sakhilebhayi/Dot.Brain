---
title: Dot.Brain — Failure Knowledge Base
version: 1.1.0
status: active
owners: [SRE Lead, Resilience Agent]
reviewing-agent: Security Agent
last-review: 2026-10-16
review-cadence: monthly
---

# Failure Knowledge Base

Purpose: the catalog that turns incidents into assets — the failure taxonomy, the blameless-review record format ([ADR-0008](adr/ADR-0008-blameless-review-policy.md) enforced structurally here), and the promotion path from catalog entry to the λ=0 lessons the learning loop propagates ecosystem-wide within 72 hours. The founding stance: **a failure the ecosystem paid for once and learns from forever is cheaper than a success it can't explain.** The defining metric of the whole repository — `resilience.repeat_incident_rate`, declining — is won or lost in this file's discipline.

> **Related documents:** [brain.resilience.md](brain.resilience.md) — the incident lifecycle this catalog feeds from · [ADR-0008](adr/ADR-0008-blameless-review-policy.md) — blameless policy canon · [templates/post-incident-review.template.md](templates/post-incident-review.template.md) — the record form · [brain.learning.md](brain.learning.md) Loop D — lesson propagation · [brain.memory.md](brain.memory.md) — lessons are always-hot, never-forget.

---

## 1. Failure taxonomy

Every catalog entry carries exactly one primary class (secondary tags free):

| Class | Definition | Examples |
|---|---|---|
| **F-KNOW** Knowledge failures | Wrong, stale, or corrupted knowledge acted on | Poisoned pack ingested (T1), false SAME_AS merge, stale index serving superseded knowledge |
| **F-INFER** Inference failures | Correct inputs, wrong conclusion | I-rule misapplication, confidence miscalibration, missed contradiction |
| **F-PROC** Process failures | Pipeline/gate/workflow breakdown | Gate bypass attempt, ledger-graph ordering violation, expired sign-off honored |
| **F-INFRA** Infrastructure failures | Systems down or degraded | Tier RTO/RPO breach, event-bus sequence gaps, index corruption |
| **F-HUMAN** Interface failures | Human-Brain interaction broke down | Uncomprehended Why block led to bad decision, wrong persona rendering, alert fatigue |
| **F-BOUND** Boundary failures | The Brain acted outside its identity | Any `identity.boundary_violations` hit, budget abuse, unconsented experiment exposure |

The taxonomy is deliberately about *what failed*, never *who* — a classification requiring a person's name to make sense is misclassified (ADR-0008 §1 in mechanical form). New classes need Resilience + Governance agreement; six sufficed at design time.

## 2. The catalog entry — blameless review record

Each entry is a completed post-incident review ([templates/post-incident-review.template.md](templates/post-incident-review.template.md)) plus catalog metadata:

| Field | Rule |
|---|---|
| `failure_id` | `F-<class>-<year>-<seq>`; stable forever, cited by lessons and advisories |
| Timeline | Detection → diagnosis → mitigation → resolution, with MTTD/MTTR contributions |
| Root causes | Systems, conditions, process gaps — plural encouraged; a single root cause is usually an unfinished analysis. Naming an individual returns the record unaccepted |
| Contributing factors | What made it worse or slower — including absent telemetry ("we couldn't see X") |
| What worked | Controls that held; drills that paid off. Mandatory — reviews that only record failure teach half the incident |
| Blameless attestation | Per template §8, signed by the review facilitator |
| Lesson candidates | Zero or more — an incident with no extractable lesson is legitimate and recorded as such |

Entries are `restricted` by default (incident details often expose control internals); extracted lessons are published at the widest classification their content allows — the *learning* travels even when the *forensics* don't.

## 3. From catalog entry to λ=0 lesson

```mermaid
flowchart LR
    I[Incident resolved<br/>brain.resilience.md lifecycle] --> PIR[Blameless PIR<br/>within 5 working days]
    PIR --> CAT[Catalog entry<br/>F-class + failure_id]
    CAT --> LC{Lesson candidates?}
    LC -- none --> DONE[Entry stands as forensics]
    LC -- yes --> V[Verification ≤ 30 days<br/>lesson tested, not assumed]
    V --> L[lesson pack: \u03bb=0, always-hot,<br/>never-forget set]
    L --> P[Propagation \u2264 72 h<br/>Loop D + advisories to<br/>similarly-exposed platforms]
    P --> R[Repeat-incident watch:<br/>same class + same mechanism<br/>= the metric that matters]
```

Promotion rules:
- **Verification before propagation** — a lesson is a testable claim ("validating X at ingestion prevents Y"); it is exercised (drill, replay, or targeted test) before earning λ=0. `resilience.lessons_verified_within_30d = 100%`.
- **λ=0 is earned, not automatic** — unverified candidates decay like ordinary knowledge; the never-forget set admits only what proved out. This keeps the always-hot tier from silting up with plausible-but-untested morals.
- **Cross-platform propagation** — the Resilience Agent maps each lesson against the platform registry for shared exposure; advisories go out as packs ([brain.resilience.md](brain.resilience.md)), acceptance tracked by `resilience.lesson_adoption_rate ≥ 50%`.
- **Repeat definition** — same class *and* same mechanism recurring counts against `resilience.repeat_incident_rate`; same class alone does not (two different F-INFRA outages aren't a repeat; the same unvalidated input path failing twice is).

## 4. Reading the catalog — failure patterns

Quarterly, the Resilience Agent reads the catalog *across* entries (the analytics discipline applied to failure): class distribution shifts, recurring contributing factors (absent telemetry appearing three times is a telemetry roadmap item, not a coincidence), and MTTD/MTTR outliers. Cross-entry findings pack as analysis DKPs ([brain.analytics.md](brain.analytics.md) §3) — patterns in failure are among the highest-value knowledge the ecosystem produces, and the file-drawer rule applies to them doubly.

## 5. Worked example — F-KNOW-2026-001

The near-miss from [brain.semantic.md](brain.semantic.md) §6 run forward as if the merge had shipped:

1. **Incident:** waterlogging observations pooled into deficit-irrigation recommendations after an auto-applied SAME_AS merge; wrong recommendation caught by a Dot.Farms agronomist pre-merge of the PR. Class F-KNOW; detection credit: the human reviewer — recorded as *what worked: PR-based delivery contained the blast radius*.
2. **Root causes:** (a) similarity threshold treated as sufficient evidence — process gap; (b) no hard negative set for SAME_AS evaluation — absent control; (c) merge path lacked a review gate — design gap. Three causes, no names.
3. **Lesson candidate:** "SAME_AS candidates are never auto-merged." Verified by replaying the merge against the golden pack suite showing evidence pooling; promoted to λ=0.
4. **Propagation:** lesson pack in 48 h; [brain.semantic.md](brain.semantic.md) §3's no-auto-merge rule is the lesson institutionalized as spec — the catalog entry is *why* that rule exists, permanently citable as `F-KNOW-2026-001`.
5. **Repeat watch:** any future evidence-pooling-via-merge incident is a repeat and a governance finding, not just an ops issue.

## 5a. Catalog entry — F-INFRA-2026-001 (shared crontab, silent scheduler death)

The first production entry, recorded from the platform side (Dot.Mines wiki 0.4.4, Dot.Central docs §8 "Crontab rules") and the guardian's own issue trail. Two incidents, one failure: every Dot platform deploys to one hosting account with **one crontab**, and that crontab had several writers that did not know about each other.

1. **Timeline.** 2026-08-31 21:58 UTC a sibling platform's analytics-setup pipeline rewrote the account crontab from an empty read and dropped Dot.Mines' `schedule:run` line. No page turned red: queued jobs drained only when a human visited, manufacturer syncs stopped, and the guardian filed freshness recommendations that were read as provider stalls. Detected 2026-10-16 ~18:00 UTC while chasing why a new scheduled command never ran (MTTD ≈ 46 days). Mitigated the same day by a deploy that reinstalls the line. At 18:37 UTC the hardened block was exercised for real: three deploys dispatched at the same second raced on the crontab; two refused and "restored" — one of them restoring the empty crontab it had read mid-write. Every Dot scheduler was dead for seven minutes until the deploys were re-run one at a time (18:43–18:48 UTC). Lock merged 18:52 UTC.
2. **Root causes.** (a) One shared crontab with per-app writers that overwrote the whole file — design gap. (b) A writer that treated a failed `crontab -l` as "no crontab" and installed empty — process gap. (c) Per-repository CI concurrency groups that never covered a resource shared across repositories — boundary gap. (d) No liveness check on the scheduler itself; every probe that existed measured the web tier — absent telemetry. Four causes, no names.
3. **Contributing factors.** `cron`'s minimal `PATH` resolves a different PHP binary than the login shell, so even a present line can run the wrong interpreter; scheduler output went to `/dev/null`; the guardian's `telemetry_ingestion` check had been tuned to distrust itself after the provider-feed episode, so a dead scheduler looked like a slow provider.
4. **What worked.** The verified block's refuse-and-restore held exactly as designed in the race (no partial crontab was ever installed); the guardian's recommendation trail gave the date to within a minute; the platform's own `server-logs` evidence workflow turned a hypothesis into a crontab listing in two minutes.
5. **Lessons (verified 2026-10-16 by re-running every deploy and reading the crontab back).** L1 — a crontab writer rewrites only lines carrying its own marker, re-reads, and restores on mismatch. L2 — writes to a shared file are serialised with a lock (`flock` on `~/.dot-crontab.lock`), not merely verified. L3 — every platform runs an external scheduler watchdog (GitHub Actions, 15 min) that reads a scheduler heartbeat, not the web tier. L4 — a deploy re-asserts the platform's cron line, which gives the guardian a `redeploy` runbook for `scheduler` ([ADR-0014](adr/ADR-0014-dot-guardian-architecture.md) 1.0.1). Propagated as the same generated block in six repositories (Dot.Mines, Dot.Central, Dot.Memory, Dot.Doc, Dot.Charts, Dot.Dopemine) and as deploy rules in each.
6. **Repeat watch.** Any crontab write outside the generated block, or any deploy that reports fewer "other lines preserved" than the previous deploy, is a repeat and a governance finding.

Classification `ecosystem` (no control internals exposed; host and account names withheld).

## 6. Health metrics

Registered in [brain.metrics.md](brain.metrics.md): `resilience.repeat_incident_rate` (declining — **the defining metric**) · `resilience.lessons_verified_within_30d = 100%` · `resilience.lesson_adoption_rate ≥ 50%` · `resilience.mttd_p50` / `resilience.mttr_p50` (declining trends, computed from catalog timelines) · `colony.lesson_propagation_latency ≤ 72 h`. Also registered (§4.9, 1.4.0): `failures.pir_completion_within_5d` (100% — a PIR that waits loses the details that matter) and `failures.entries_with_what_worked` (100% — half-incident reviews are a taxonomy violation).

---

## Change Log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-08-01 | Brain Document Generator (prompt 03, AI) | Initial knowledge base: six-class taxonomy, blameless record format with mandatory what-worked, verified-lesson promotion path (λ=0 earned not automatic), cross-entry pattern reading, F-KNOW-2026-001 worked example |
| 1.1.0 | 2026-10-16 | Reliability pass (Dot.Mines scheduler outage) | §5a: first production catalog entry F-INFRA-2026-001 (shared crontab, 46-day silent scheduler death and the same-day deploy race), four lessons verified and propagated to six platform repositories |

## Open Questions

| Question | Owner → Approver |
|---|---|
| ~~Register `failures.pir_completion_within_5d` and `failures.entries_with_what_worked` in brain.metrics.md §4.9 (batch restarts at 2)~~ Registered in [brain.metrics.md](brain.metrics.md) §4.9 (1.4.0) | Resilience Agent → SRE Lead |
| Should near-misses (caught before impact, like the §5 example's real history) get first-class catalog entries, or only a lighter near-miss log? | Resilience Agent → SRE Lead |
| Catalog entries are `restricted` — do platform partners get a redacted catalog view for shared-exposure awareness, or advisories only? | Security Agent → Security Officer |
