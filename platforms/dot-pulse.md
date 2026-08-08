---
title: Dot.Pulse — Platform Knowledge
version: 1.1.0
status: active
owners: [Pulse Platform Lead, Community Agent, Registry Agent]
platform-id: dot-pulse
dkp-version: 1.0.0
integration-status: publishing
last-review: 2026-08-01
---

# Dot.Pulse

> **Platform-owned source:** [Dot.Pulse's wiki.md](https://github.com/sakhilebhayi/Dot.Pulse/blob/main/wiki.md) — the platform's own knowledge home. This document is Dot.Brain's ingested view; the wiki is authoritative for what the platform actually is.

## 1. Purpose & Business Domain

The ecosystem's social and discussion platform: communities of practice, Q&A threads, announcements, and peer knowledge exchange across organizations. Owns the discussion domain: threads, communities, moderation records. Pulse's relationship to the Brain is unusual — its raw material is human conversation, which is simultaneously the richest possible knowledge source and the most privacy-sensitive. The **discussion-pack privacy review** (registry gap, closed in §7) resolves this tension: what may leave the platform is *thematic aggregates*, never conversational content. And as the platform where prohibited-metric patterns naturally concentrate (likes, streaks, follower counts, viral mechanics), Pulse is dot-dopemine's heaviest constraint consumer (§8).

## 2. Entities Owned

| Entity | Graph node type | Natural key | Notes |
|---|---|---|---|
| Community | `entity:site` | community ID | Tenant sub-scope; may be cross-org |
| Thread | `entity:process` | thread ID | Content never leaves the platform |
| Topic-signal observation | `observation` | topic × community-cohort × window | Thematic aggregate only, per §7 |
| Answered-question outcome | `outcome` | thread + resolution | Resolution ground truth (accepted answer, time-to-answer) |
| Moderation record | `entity:process` | case ID | Platform-internal; aggregates only publishable |

## 3. Events Emitted

| Event | Trigger | Consumers | Frequency |
|---|---|---|---|
| `social.thread.resolved/expired` | Q&A resolution lifecycle | Brain (aggregate), community dashboards | ~10²/day |
| `social.topic.trending` | Topic-signal threshold crossed (post-privacy-gate) | Brain, Dot.Notify | low |
| `social.moderation.case_closed` | Moderation resolution | Brain (aggregate only) | low |

## 4. Knowledge Packs Published

| Payload type | Cadence | Example pack ID |
|---|---|---|
| observation (topic signals, resolution-rate aggregates) | weekly | `dkp:pulse:obs:2026-07-13:0011` |
| insight (recurring-problem findings from topic clusters) | per finding | `dkp:pulse:ins:2026-06-20:0002` |
| outcome (recommendation verifications) | per verified recommendation | `dkp:pulse:out:2026-07-28:0001` |
| incident (privacy-gate failures, moderation-pattern incidents) | per incident | `dkp:pulse:inc:2026-04-18:0001` |

**The topic-signal pack — Pulse's distinctive contribution:** when practitioners across ≥ 5 organizations independently discuss the same operational problem, that convergence is evidence the Brain can get nowhere else — often *before* the problem shows up in any platform's metrics. The pack carries topic label, community-cohort size, trend direction, and links to which platform domain it concerns. It carries zero quotes, zero usernames, zero thread links.

## 5. Intelligence Consumed

| Recommendation type | Metric expected to move | Baseline |
|---|---|---|
| Expertise-routing (route unanswered questions to communities with resolution history) | `social.question_resolution_rate` | 2026 H1 |
| Community-seeding (propose a community where topic signals show unmet demand) | `social.time_to_first_answer_p50` | per topic |
| Cross-platform early warnings (a topic signal names a domain problem → domain platform alerted) | domain platform's metric | per signal |

## 6. Cross-Platform Relationships

```mermaid
flowchart LR
    U[Practitioner discussions] --> P[Dot.Pulse]
    P -->|privacy gate §7| G[Topic-signal packs]
    G --> B[Brain]
    B -->|early warning| DP[Domain platforms: Farms, Mines, ...]
    DD[Dot.Dopemine prohibited list] -->|heaviest constraint| P
    P -->|notification requests| N[Dot.Notify]
```

Early-warning example: Kolomela-adjacent haul-road discussions trended in mining communities weeks before the 2026-03 wet-season observation packs landed — retrospectively, the topic signal was the chain's earliest evidence. Topic signals are I4-grade (uncontrolled, self-selected populations); they seed hypotheses, never verify them.

## 7. Tenancy Model & Discussion-Pack Privacy Review (registry gap closed)

Tenant key = organization; communities may span tenants (cross-org communities are `ecosystem`-scoped by construction). The **privacy-review contract** every discussion-derived pack must pass before signing:

| Gate | Rule |
|---|---|
| Content exclusion | No quotes, paraphrases, usernames, thread IDs, or community names below cohort floor — topic labels come from the shared taxonomy, not from member text |
| Cohort floor | n ≥ 50 distinct participants per topic × window; cross-org signals additionally ≥ 5 distinct organizations |
| Re-identification check | Topic × cohort × window combination tested against small-cell intersection before publication |
| Moderation exclusion | Moderation data publishable only as platform-level quarterly aggregates; never per community |
| Human sign-off | Security Officer approves the gate *configuration*; per-pack passage is then mechanical (manifest-declared, validated at ingestion) |

## 8. Dopamine Surface (heaviest prohibited-list consumer)

Every prohibited-metric pattern (dot-dopemine §7) has a natural social instantiation, and Pulse withholds them all: like/upvote counts as targets (raw engagement), posting streaks (loss-framed streaks), follower/karma leaderboards (person-vs-person rate metrics), notification-driven re-engagement loops (abandonment nudges), algorithmic virality feeds (variable-ratio rewards). What Pulse *does* share: question-resolution rate and time-to-first-answer — communities are for getting answered, and the only certified mechanic deployed is accepted-answer recognition (outcome-anchored: the question was actually resolved). Pulse is the standing test case for whether a social platform can run on outcome mechanics alone; its coupling data feeds dot-dopemine's evidence base.

## 9. Active Recommendations

Maintained by the Registry Agent. Current: expertise-routing `verified` — see §13; community-seeding for a post-harvest-storage topic cluster `open` (expiry 2026-09-10).

## 10. Incident History Summary

One incident pack (2026-04): a draft topic-signal pack included a community name whose small size made members identifiable — caught by the re-identification check pre-publication, published as an incident anyway (near-miss transparency); lesson hardened the small-cell rule into the mechanical gate. Consumed: dot-dopemine's decertified-streak lesson at catalog-subscription time.

## 11. Domain Metrics (registered per brain.metrics.md §4.8)

| ID | Type | Definition |
|---|---|---|
| `social.question_resolution_rate` | ratio | Threads with accepted answer / question threads, monthly |
| `social.time_to_first_answer_p50` | duration | Question posted to first substantive answer, median |
| `social.topic_signal_precision` | ratio | Topic signals later corroborated by domain-platform evidence / signals published — is the early-warning channel real? |

## 12. Manifest (platform.dkp.json example)

```json
{
  "platform_id": "dot-pulse",
  "dkp_version": "1.0.0",
  "signing_key_ref": "vault://keys/dot-pulse/dkp-signing/v1",
  "publishes": ["observation", "insight", "outcome", "incident"],
  "subscribes": ["expertise-routing", "community-seeding", "early-warning"],
  "schemas": { "knowledge-pack": "1.0.0", "metric": "1.0.0" },
  "default_classification": "ecosystem",
  "tenancy": {
    "key": "org_id",
    "aggregation_floor": 50,
    "publication_rules": [
      { "rule": "discussion-privacy-gate", "min_orgs_cross_tenant": 5, "enforcement": "reject-at-ingestion" }
    ]
  }
}
```

## 13. Worked round-trip

1. **Pack:** `dkp:pulse:obs:2026-07-13:0011` — topic-signal aggregates showing agronomy communities' unanswered post-harvest-storage questions clustering (n = 83 participants, 7 orgs; all §7 gates pass) alongside a storage-specialist community with 0.91 resolution rate.
2. **Validation → graph:** `OBSERVED_WITH` edge between question-topic cluster and the specialist community's resolution history, 0.70; corroborated by Farms' post-harvest-loss observations (×1.10 → 0.77) — the social signal and the operational metric agree.
3. **PR back (expertise-routing):** route storage-topic questions to the specialist community; confidence 0.80, impact `social.time_to_first_answer_p50` −30% predicted for the topic, guard `social.question_resolution_rate` flat-or-better, expiry 45 days.
4. **Outcome:** `dkp:pulse:out:2026-07-28:0001` — −37% time-to-first-answer verified against pre-routing baseline; resolution rate up 4 points. Side effect logged for `social.topic_signal_precision`: the same topic cluster was forwarded to Dot.Farms as an early warning, corroborated by its own loss data — first precision-numerator entry.

## Verified Infrastructure State (2026-08-07)

Confirmed directly against the real repo during the ecosystem-wide standardization + code-quality pass (full 26-platform summary: [brain.platforms.md](../brain.platforms.md) change log, v1.0.21):

- **Legal/branding/auth** — branded Markdown-mail theme, complete POPIA-aligned Privacy Policy/Terms/Cookie Policy naming **BluePin Inc**, guest auth pages restyled to match the welcome-page hero.
- **Laravel Boost** — `laravel/boost` ^2.5 installed. This repo auto-detected **both** Claude Code and GitHub Copilot as configured agents — the only platform in the pass to get both `CLAUDE.md` and `AGENTS.md` guideline files; `.mcp.json`/`boost.json` also in place. (Ran on the `feature/ecosystem-sso` branch, consistent with the rest of this platform's recent work.)
- **Code-quality pass** — Pint: 92 files reformatted, formatting-only. `composer audit`: patched 6 `league/commonmark` DoS advisories. `npm audit`: patched postcss path-traversal + shell-quote ReDoS (via concurrently). Full suite reconfirmed green (106 tests / 99 passed / 186 assertions) after every change.

## Autonomy Classification (brain.autonomy.md)

Per [brain.autonomy.md](../brain.autonomy.md) §2. Audited against the real codebase at `~/Dot/Dot.Pulse` on 2026-08-08 — not aspirational.

### Level 1 — Autonomous

- **Trending hashtag recalculation** — `app/Console/Commands/RecalculateTrending.php` (`pulse:trending`), scheduled hourly in `routes/console.php`. Recomputes published-post hashtag counts and busts a cache key. No content, money, or user standing is affected; pure derived-metric refresh. Routine analytics/monitoring per §2's Level 1 examples.
- **Badge eligibility awarding** — `app/Console/Commands/AwardBadges.php` (`pulse:badges`), scheduled daily at 03:00, delegates to `app/Services/BadgeAwarder.php`. Grants achievement badges to users based on activity; reversible, additive, non-adversarial gamification bookkeeping. Routine internal task management.
- **Queue worker execution** — `Schedule::command('queue:work --stop-when-empty')->everyFiveMinutes()->withoutOverlapping()` in `routes/console.php`. Infrastructure plumbing that drains the queue (database driver, per `config/queue.php` / `QUEUE_CONNECTION=database`), not a business decision itself.
- **Transactional notifications** — `app/Notifications/{NewFollower,PostReacted,NewCommentOnPost,MentionNotification,SolutionAccepted}.php`, all `ShouldQueue`, database-channel only. Routine, expected, user-triggered social notifications (someone followed you, your post got a reaction) — no owner approval implicated.
- **AI post enrichment (metadata only)** — `app/Jobs/EnrichPost.php` → `app/Services/AiModerationService.php` generates summary/tags/sentiment/topics/keywords via Claude and writes them to `PulsePostEnrichment`. The enrichment itself (non-publishing metadata) is routine automated tagging/analytics.

### Level 2 — Escalate

None found as currently implemented. I checked every queued job (`app/Jobs/EnrichPost.php`), every scheduled command (`routes/console.php`, `app/Console/Commands/*`), and every controller action with side effects (`app/Http/Controllers/Api/V1/PostController.php`, `PulseController.php`) for a "system prepares, human approves before execution" pattern per §2's Level 2 shape. There isn't one — Dot.Pulse's automated actions either execute directly (Level 1 in mechanism, see the moderation gap below) or land in a human-only queue with zero automated pre-action (Level 3, next section). No code path pauses a prepared action for authorized sign-off before it takes effect.

**Flagged as a genuine gap, not a finding to file under Level 2:** `AiModerationService::upsertEnrichment()` (`app/Services/AiModerationService.php`) auto-executes two content-standing decisions with no human step *before* they take effect — `moderation_status: approved` auto-publishes the post (`$post->update(['status' => 'published'])`, fires `PostPublished`), and `moderation_status: rejected` auto-removes it (`$post->update(['status' => 'removed'])`) — both driven by an unreviewed Claude classification. Per the task brief's own framing, auto-removal of user content without human review is exactly the case that "would need careful Level 2/3 classification." As built, this process is *mechanically* Level 1 (it executes without owner or moderator approval, in either direction) despite being reputational/speech-affecting — it does not currently have the "prepare and wait for approval" shape Level 2 requires. This is recorded as a design gap in the summary below, not relabeled Level 2, because relabeling it would misdescribe what the code actually does today.

### Level 3 — Human Control

- **Manual moderation queue (human-only actions)** — `app/Livewire/Pulse/ModerationQueue.php`, backing `resources/views/livewire/pulse/moderation-queue.blade.php` and `resources/views/pulse/moderation/index.blade.php`, routed at `/moderation` (`routes/web.php`, gated by `moderator`/`admin` role in `PulseController::moderation()` and `ModerationQueue::authorizeModeratorAccess()`). `approve()` and `reject()` are moderator-only actions, each writing a `PulseModerationLog` row with `is_ai_decision: false`. This queue only ever surfaces posts already sitting in `pending`/`flagged` status — it has no code path for restoring a post the AI already auto-removed (`status: removed`), so that particular removal decision is fully outside human control as implemented, which is the gap flagged under Level 2 above.
- **User content reporting → human record, no auto-action** — `POST /api/v1/posts/{id}/report` (`routes/api.php`) → `PostController::report()` → `app(ReportContent::class)->handle(...)`. Creates a report record for later human handling; confirmed no automated removal or penalty fires from a user report alone.
- **Role/permission assignment** — moderator/admin role is a `PulseProfile.role` column checked ad hoc (`PostPolicy::isModerator()`, `PulseController::moderation()`, `ModerationQueue::authorizeModeratorAccess()`); no self-service or automated path elevates a user to `moderator`/`admin` anywhere in the routes or controllers I checked — this is operator-only account administration, done outside the app (direct DB/admin action).
- **CI/CD and deployment** — confirmed no `.github/workflows/*` or any CI pipeline file exists in the repo (`find . -iname "*.yml"` under the app tree returns nothing outside `node_modules`/`vendor`). Only `.github/copilot-instructions.md` and `.github/agents/dot-pulse.agent.md` exist, which are AI-agent guidance files, not automation. Deployment is manual/human-operated by default (Laravel Cloud is named as the deploy target in `CLAUDE.md`, but no automated deploy trigger exists in this repo).
- **Legal/policy content** — Privacy Policy, Terms, Cookie Policy (`routes/web.php` `/cookies`, Jetstream `terms.show`/`policy.show`) are static Markdown files a human authors and commits; nothing in the app generates or edits their content.

### Gap summary

Dot.Pulse has no real Level 2 process today: nothing in the codebase prepares an action and waits for authorized human approval before executing. Its most consequential automation — AI-driven auto-publish and auto-remove in `AiModerationService::upsertEnrichment()` — currently behaves as unreviewed Level 1 despite affecting user content standing, and the moderation queue has no restore path for AI-auto-removed posts. The platform's first genuine Level 1 process (in the *good* sense — safe, low-stakes, already correctly unsupervised) already exists (trending recalculation, badge awarding); its first genuine Level 2 process would require inserting a human-approval gate ahead of the `rejected → removed` transition (e.g., route `rejected` into the existing moderator queue instead of auto-executing) so content removal follows the same Context → Evidence → Risk → Recommendation → Proposed Action shape §2 requires.

## Change Log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-08-01 | Platform Integrator (prompt 05, AI) | Initial integration package: discussion-domain ownership, discussion-pack privacy review closed as five-gate mechanical contract, topic-signal packs as I4 early-warning channel, all five prohibited-list patterns withheld (standing outcome-mechanics-only test case), 3 domain metrics, worked round-trip |
| 1.0.1 | 2026-08-01 | Repository Reviewer (prompt 07, AI) | Notify-consent OQ struck (resolved by dot-notify.md) |
| 1.0.2 | 2026-08-01 | DKP Architect (prompt 02, AI) | Taxonomy OQ struck (schemas/taxonomy.json published) |

| 1.0.3 | 2026-08-01 | Repository Steward Agent | Linked to Dot.Pulse's own wiki.md (platform repo) as the platform-owned source of truth |
| 1.1.0 | 2026-08-08 | Platform Autonomy Classification sub-project | Added Autonomy Classification section per brain.autonomy.md §2 |

## Open Questions

| Question | Owner → Approver |
|---|---|
| ~~Topic labels depend on the shared taxonomy — third consumer waiting on schemas/taxonomy.json (with Emall and semantic)~~ **Resolved 2026-08-01:** [schemas/taxonomy.json](../schemas/taxonomy.json) published; `social.topic.signal` frozen | Knowledge Agent → Chief Knowledge Engineer |
| ~~Cross-org early warnings to a domain platform: does the receiving platform's human lead need notification-consent configuration in Dot.Notify? Resolve in dot-notify's session~~ **Resolved 2026-08-01** by [dot-notify.md](dot-notify.md): `cross-org-early-warning` scope, default-off, role-addressed, degrade-to-digest | Community Agent → Security Officer |
