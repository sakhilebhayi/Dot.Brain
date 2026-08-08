---
title: Dot.Dopemine — Platform Knowledge
version: 1.1.0
status: active
owners: [Dopemine Platform Lead, Ethics Agent, Registry Agent]
platform-id: dot-dopemine
dkp-version: 1.0.0
integration-status: publishing
last-review: 2026-08-01
---

# Dot.Dopemine

> **Platform-owned source:** [Dot.Dopemine's wiki.md](https://github.com/sakhilebhayi/Dot.Dopemine/blob/main/wiki.md) — the platform's own knowledge home. This document is Dot.Brain's ingested view; the wiki is authoritative for what the platform actually is.

## 1. Purpose & Business Domain

The ecosystem's engagement and motivation platform: progress surfaces, recognition mechanics, and habit scaffolding delivered *as a service* to other platforms. Highest governance stakes in the fleet — this platform's product is precisely the thing brain.dopemine.md exists to constrain. The resolution is not exemption but inversion: Dot.Dopemine operates under the strictest interpretation of the policy it embodies, and its distinctive contribution to the Brain is *negative knowledge* — the prohibited-metric list (§7, registry gap closed) and evidence about which engagement mechanics helped versus harmed.

**The acid test, applied to itself (§8):** every other platform answers "would you show this mechanic to the person it targets, with its intent labeled?" Dopemine must answer it for every mechanic it *offers*, not just uses. A mechanic that fails the test may not be in the service catalog at all — there is no "the consuming platform decides" escape hatch, because offering a dark pattern is manufacturing one.

## 2. Entities Owned

| Entity | Graph node type | Natural key | Notes |
|---|---|---|---|
| Engagement mechanic | `entity:asset` | `mech:<name>` | Catalog entry, each with a recorded acid-test verdict |
| Deployment | `entity:process` | mechanic + platform | A mechanic live on a consuming platform |
| Wellbeing observation | `observation` | mechanic + cohort + window | Aggregate only, n ≥ 50 |
| Mechanic outcome | `outcome` | deployment + period | Outcome-metric movement vs. engagement movement, always paired |
| Prohibited-metric entry | `entity:asset` | metric pattern | The negative catalog (§7) |

## 3. Events Emitted

| Event | Trigger | Consumers | Frequency |
|---|---|---|---|
| `engagement.mechanic.certified/decertified` | Acid-test verdict recorded / revoked | Brain, all consuming platforms | low |
| `engagement.deployment.started/retired` | Mechanic lifecycle on a platform | Brain, Dot.Design | low |
| `engagement.prohibited_list.updated` | Prohibited-metric list change | Brain registry, **all platforms** (mandatory subscription) | rare |

## 4. Knowledge Packs Published

| Payload type | Cadence | Example pack ID |
|---|---|---|
| observation (mechanic outcome/engagement pairs) | monthly | `dkp:dopemine:obs:2026-07-01:0004` |
| insight (mechanic effectiveness/harm findings) | per finding | `dkp:dopemine:ins:2026-06-02:0001` |
| outcome (deployment verifications) | per verified deployment | `dkp:dopemine:out:2026-07-15:0001` |
| incident (mechanic-harm findings, decertifications) | per incident | `dkp:dopemine:inc:2026-05-10:0001` |

Publication rule unique to this platform: an observation pack pairing engagement movement with outcome movement is publishable; engagement movement *alone* is not — it is a prohibited-metric pattern (§7) and validation rejects it at ingestion.

## 5. Intelligence Consumed

| Recommendation type | Metric expected to move | Baseline |
|---|---|---|
| Mechanic-retirement candidates (engagement up, outcomes flat) | `engagement.decoupling_findings` | 2026 H1 |
| Deployment-fit suggestions (which certified mechanic suits a platform's outcome goal) | consuming platform's outcome metric | per deployment |

## 6. Cross-Platform Relationships

```mermaid
flowchart TD
    D[Dot.Dopemine catalog] -->|certified mechanics only| P[Consuming platforms: HR, Tasks, Projects, Pulse...]
    D -->|prohibited-metric list| ALL[All 21 platforms — mandatory]
    E[Ethics Officer] -->|certification approval| D
    D -->|wellbeing + outcome packs| B[Brain]
    B -->|decoupling findings| D
```

Every platform doc's "Dopamine Surface" section (§8 in each) is downstream of this catalog: what Farms, Mines, Emall, Billing, and Analytics chose to *withhold* are instances of prohibited-metric patterns published here. Consuming platforms deploy only certified mechanics; certification is Ethics-Officer-approved and revocable.

## 7. Tenancy Model & the Prohibited-Metric List (registry gap closed)

Tenant key = consuming platform + org; wellbeing aggregates at n ≥ 50 individuals (behavioral data — stricter than default). The **prohibited-metric list** is the platform's flagship published artifact, `ecosystem`-classified and mandatorily subscribed:

| Pattern | Why prohibited | Example already withheld |
|---|---|---|
| Raw engagement volume as a target (dwell time, session count, opens) | Rewards attention, not outcomes | Emall browse-time; Analytics dashboard-view rankings |
| Individual streaks with loss framing | Manufactures compulsion via loss aversion | Emall visit streaks; Billing payment streaks |
| Person-vs-person leaderboards on rate metrics | Rewards speed over safety/quality | Mines operator speed leaderboards |
| Variable-ratio reward schedules | Slot-machine mechanics | None deployed (blocked at catalog) |
| Abandonment/re-engagement pressure nudges | Exploits incompleteness anxiety | Emall cart-abandonment nudges; Billing dunning-pressure |

List governance: additions by Ethics Agent proposal → Ethics Officer approval; *removals* require full governance review (an evolution-rules change, not an update). Every entry cites the evidence or reasoning that put it there. Validation enforces the list mechanically: any platform's pack or PR targeting a prohibited pattern is rejected with the list entry cited.

## 8. Dopamine Surface (the platform's own)

Shares: certified-mechanic outcome performance, decoupling-finding counts — its own product honesty. Withheld: *adoption metrics of its own mechanics as success* — "12 platforms use streaks" is precisely the engagement-as-outcome error applied reflexively. Dopemine's success metric is outcome movement on consuming platforms, per §11.

## 9. Active Recommendations

Maintained by the Registry Agent. Current: mechanic-retirement review for two catalog entries showing decoupling `open` (expiry 2026-09-01); one deployment-fit recommendation `verified` — see §13.

## 10. Incident History Summary

One incident pack (2026-05): a pilot completion-streak mechanic on Dot.Tasks showed task-completion inflation with quality flat — engagement/outcome decoupling caught by the paired-publication rule; mechanic decertified, incident published, lesson became prohibited-list entry evidence (loss-framed streaks row). This incident is the platform's founding credibility artifact: it decertified its own product.

## 11. Domain Metrics (registered per brain.metrics.md §4.8)

| ID | Type | Definition |
|---|---|---|
| `engagement.outcome_coupling_rate` | ratio | Deployments where outcome metric moved with engagement / all active deployments |
| `engagement.decoupling_findings` | count | Engagement-up-outcome-flat findings per quarter (each triggers retirement review) |
| `engagement.prohibited_list_rejections` | count | Packs/PRs rejected by list enforcement per quarter — visibility of the guardrail working |

## 12. Manifest (platform.dkp.json example)

```json
{
  "platform_id": "dot-dopemine",
  "dkp_version": "1.0.0",
  "signing_key_ref": "vault://keys/dot-dopemine/dkp-signing/v1",
  "publishes": ["observation", "insight", "outcome", "incident"],
  "subscribes": ["mechanic-retirement", "deployment-fit"],
  "schemas": { "knowledge-pack": "1.0.0", "metric": "1.0.0" },
  "default_classification": "ecosystem",
  "tenancy": {
    "key": "platform_org_id",
    "aggregation_floor": 50,
    "publication_rules": [
      { "rule": "engagement-outcome-pairing", "enforcement": "reject-at-ingestion" }
    ]
  }
}
```

## 13. Worked round-trip

1. **Pack:** `dkp:dopemine:obs:2026-07-01:0004` — paired engagement/outcome aggregates for the certified "milestone recognition" mechanic on Dot.Projects, 3 months, n = 74 (≥ 50 floor holds).
2. **Validation → graph:** `OBSERVED_WITH` edge between milestone recognition and on-time phase completion at 0.71; corroborated by an independent HR-deployment observation (×1.10 → 0.78).
3. **PR back (deployment-fit):** offer milestone recognition to Dot.Farms for harvest-plan phase tracking; confidence 0.80, impact on Farms' `agriculture.harvest_logistics_delay_p50`, guard: paired wellbeing aggregate flat-or-better, expiry 60 days. Farms' human lead accepts — sovereignty intact; the mechanic ships with its intent label visible to end users (the acid test, literally rendered).
4. **Outcome:** `dkp:dopemine:out:2026-07-15:0001` — outcome metric −9% (verified against counterfactual plan), engagement and outcome coupled, wellbeing guard flat. `engagement.outcome_coupling_rate` holds at 1.0 for the deployment.

## Verified Infrastructure State (2026-08-07)

Confirmed directly against the real repo during the ecosystem-wide standardization + code-quality pass (full 26-platform summary: [brain.platforms.md](../brain.platforms.md) change log, v1.0.21):

- **Legal/branding/auth** — branded Markdown-mail theme, complete POPIA-aligned Privacy Policy/Terms/Cookie Policy naming **BluePin Inc**, guest auth pages restyled to match the welcome-page hero.
- **Laravel Boost** — `laravel/boost` ^2.5 installed; `.mcp.json`/`boost.json`/`CLAUDE.md` guideline block in place.
- **Code-quality pass** — Pint: 13 files reformatted, formatting-only. `composer audit`: patched 6 `league/commonmark` DoS advisories. `npm audit`: already clean. Full suite reconfirmed green (66 tests / 59 passed / 155 assertions) after every change.

## Autonomy Classification (brain.autonomy.md)

Per [brain.autonomy.md](../brain.autonomy.md) §2. Audited against the real codebase at `~/Dot/Dot.Dopemine` on 2026-08-08 — not aspirational.

### Level 1 — Autonomous

None found. Checked: `app/Console/Commands` (directory does not exist), `routes/console.php` (only the stock `inspire` command, no `Schedule::` entries), `app/Jobs` (directory does not exist — the `jobs` DB table is present but unused, `composer.json`'s `dev` script starts `queue:listen` against an empty queue), `app/Notifications` (directory does not exist — `NotificationBell.php` reads the `notifications` table but nothing in the codebase ever calls `->notify(...)`), and `.github/` (does not exist at all — no CI, no automated test run, no deploy pipeline). No process in this codebase executes without a human clicking through the UI today.

### Level 2 — Escalate

None found. No code path in `app/Actions/Dopemine/` or elsewhere analyses data and prepares a proposal for human approval before executing (the Context → Evidence → Risk → Recommendation → Proposed Action shape required by brain.autonomy.md §2 is not implemented anywhere). The one process that would fit this level — automated "mechanic-retirement candidate" flagging from engagement/outcome decoupling — is documented in `wiki.md` §3–4.1 ("Wellbeing observation" and "Mechanic outcome" ledgers "remain design intent") and referenced only as backstory prose in a code comment in `app/Actions/Dopemine/DecertifyMechanic.php`; no model, table, job, or validation computes decoupling. Every real mutation (certify, decertify, deploy, retire) is a direct, human-initiated Livewire action, not a system-prepared recommendation awaiting sign-off.

### Level 3 — Human Control

- **Mechanic certification** — `app/Actions/Dopemine/CertifyMechanic.php` plus the acid-test gate in `app/Models/Mechanic.php`'s `static::saving()` listener (lines 60-68, throws `RuntimeException` if `status === Certified` without `acid_test_passed`). Invoked only via a human click in `app/Livewire/MechanicCatalog.php`, gated by `canGovern()` (lines 71-76: `$user->hasTeamRole($team, 'admin')`) — the Jetstream `admin` team role standing in for a not-yet-built dedicated Ethics Officer permission, per the component's own docblock.
- **Mechanic decertification** — `app/Actions/Dopemine/DecertifyMechanic.php`, requires a human-supplied `reason` string, cascades to retire all of the mechanic's `activeDeployments`; invoked via the same `canGovern()`-gated Livewire actions (`startDecertify`/`confirmDecertify`) in `app/Livewire/MechanicCatalog.php`.
- **Deploying a certified mechanic to a team** — `app/Actions/Dopemine/DeployMechanic.php` and the `MechanicDeployment::creating()` listener in `app/Models/MechanicDeployment.php` (lines 47-58); invoked via `deployToCurrentTeam()` in `app/Livewire/MechanicCatalog.php` — human-initiated, no admin gate, open to any authenticated team member.
- **Retiring a deployment** — `app/Actions/Dopemine/RetireMechanicDeployment.php`, invoked via `retire()` in `app/Livewire/MechanicDeployments.php` — human-initiated, no admin gate.
- **Seeding the initial mechanic catalog and prohibited-metric reference list** — `database/seeders/MechanicCatalogSeeder.php`, run only by a human via `php artisan db:seed`; not invoked by any job, command, or CI step.
- **Application setup and deployment** — `composer.json` `setup`/`dev` scripts (install, migrate, build, `serve`/`queue:listen`/`pail`) are human-run local operations; with `.github/` entirely absent, any deployment to production is manual end-to-end — there is no pipeline to gate in the first place.
- **Ethics Officer authority** — currently exercised as the generic Jetstream `admin` team role (`app/Providers/JetstreamServiceProvider.php:44-58`), assigned/removed by a human team owner; there is no distinct, code-enforced Ethics Officer permission separate from general team administration.

### Gap summary

Every real mutation in this codebase already requires a human click, and nothing runs unattended — so the platform has no Level 1 or Level 2 process today, only Level 3. The first real Level 1 candidate would be a scheduled, code-only job (e.g. `app/Console/Commands` + a `Schedule::` entry) that computes read-only observation/reporting output — such as the `engagement.outcome_coupling_rate` metric in §11 — with no mutation and no human step. The first real Level 2 candidate would be that same kind of job extended to detect engagement-up/outcome-flat decoupling and write a flagged "retirement candidate" record surfaced to an admin for approval, in the Context → Evidence → Risk → Recommendation → Proposed Action shape brain.autonomy.md §2 requires — none of which exists yet; today "decoupling" is documentation only (`wiki.md` §3–4.1).

## Change Log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-08-01 | Platform Integrator (prompt 05, AI) | Initial integration package: inverted-strictness posture, catalog-level acid test (no consuming-platform escape hatch), prohibited-metric list published (registry gap closed) with mechanical enforcement, engagement-outcome pairing publication rule, self-decertification incident, 3 domain metrics, worked round-trip |
| 1.0.1 | 2026-08-01 | Repository Reviewer (prompt 07, AI) | Intent-label wording OQ struck (resolved by dot-design.md §7.1) |

| 1.0.2 | 2026-08-01 | Repository Steward Agent | Linked to Dot.Dopemine's own wiki.md (platform repo) as the platform-owned source of truth |
| 1.1.0 | 2026-08-08 | Platform Autonomy Classification sub-project | Added Autonomy Classification section per brain.autonomy.md §2 |

## Open Questions

| Question | Owner → Approver |
|---|---|
| Should prohibited-list enforcement rejections be surfaced to the offending platform's human lead automatically, or batched in governance review? | Ethics Agent → Ethics Officer |
| ~~End-user-visible intent labels (§13): standard wording per persona token set — coordinate with Dot.Design's session~~ **Resolved 2026-08-01** by [dot-design.md](dot-design.md) §7.1: labels word in outcome terms, never engagement terms; jointly certified (Dopemine certifies the mechanic, Design the label) | UX Agent → UX Architect |
