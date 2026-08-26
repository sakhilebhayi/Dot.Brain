# Dot.Memory Intelligence Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Dot.Memory's authenticated experience from a technical telemetry viewer into a human-readable intelligence platform, built on the data that actually exists: the guardian's ops-incident archive (real production knowledge) plus the existing reliability telemetry (preserved as the technical view).

**Architecture:** Keep the existing dark sidebar app shell, `.dot-card` design system, and Livewire stack. Add a pure `KnowledgeTranslator` that renders each `OpsIncident` in plain language (what happened / what was learned / why it matters / trust level); five Livewire pages (Overview, Knowledge browser+search, Detail, Timeline, Insights) organized under a new "Knowledge" nav section; group the existing SLA/Indexes/Durability pages under "Reliability" with plain-language purpose strips. Track recall usage via a new envelope-only `ops_recall_events` table so "how memory helps Dot.Brain" is real, not invented.

**Tech Stack:** Laravel 12 / PHP 8.5, Livewire 3, PHPUnit, existing inline-style + `.dot-card` design tokens (Syne/Inter/JetBrains Mono, `--accent` indigo, `#09090b` ground).

## Global Constraints

- **Doctrine carve-out (decided):** `ops_incidents` is first-party ecosystem knowledge published by the guardian and read by its own account — a knowledge plane distinct from third-party tenant content. The UI may decrypt and render the `record` blob. The telemetry models stay content-free; `StoreWithoutReadingInvariantTest` is untouched; the carve-out is recorded in wiki.md's changelog entry when shipping.
- Never surface in the primary UI: memory IDs, signatures as raw strings, sev codes, retrieval scores, service names. Translate everything; raw detail lives in a collapsible "Technical detail" panel per page (brief §17).
- Every new page answers: what am I looking at / why it matters / what can I do (brief §5, §19); every list has a meaningful empty state (brief §16).
- The Memory Assistant (brief §13) and LLM-answered search (§7's NL answers) are DEFERRED: they require a Claude API key decision. Search ships structured (platform/component/status/severity filters + text match over decrypted records at current scale).
- Existing routes/pages keep working; suite must stay green; pint + bare phpstan/psalm clean on the diff.

---

### Task 1: KnowledgeTranslator (pure presenter)
Create `app/Services/Memory/KnowledgeTranslator.php` + unit tests. Maps an OpsIncident to: `headline` (component key → plain phrase, e.g. telemetry_ingestion → "Machine data stopped arriving on {Platform}"), `whatHappened`, `whatWasLearned` (from record.decision/runbook/resolution; honest "Not yet resolved — still being investigated" when open), `whyItMatters`, `severityLabel` (Critical/Serious/Minor), `statusLabel` (Being watched/Fixed/Escalated to a human/Fix was undone), `trust` (from signature recurrence + resolution history: "Proven fix" / "Needs verification" / "Recurring — no reliable fix yet"), `platformLabel` (dot-mines → Dot.Mines).

### Task 2: Recall usage tracking
Migration `ops_recall_events` (platform, signature, matches int, created_at — envelope only). OpsIncidentController@recall inserts one row per call (never-throws). Feature test.

### Task 3: Knowledge Overview (new dashboard)
Livewire `Memory\KnowledgeOverview` replacing the dashboard route's content: value-first tiles (problems seen / fixed / being watched / platforms covered), "Recently learned" feed (translated incidents, newest 5), "How memory helps Dot.Brain" (recall lookups count + last consulted), link cards into Knowledge/Timeline/Insights. Honest empty state per brief §16. Reliability tiles move to the Reliability section pages.

### Task 4: Knowledge browser + search + detail
`Memory\KnowledgeBrowser` (route /knowledge): translated cards list, filters (platform/component/status/severity), text search across headline + decrypted record. `Memory\KnowledgeDetail` (route /knowledge/{incident_uid}): the memory profile — what happened/learned/why it matters, History (detected→attempts→resolution timeline from envelope fields), Related knowledge (same signature + same component), "Used by" (recall events for its signature), Trust language, collapsible Technical detail (raw envelope + decrypted record JSON). Feature tests incl. empty states.

### Task 5: Timeline + Insights
`Memory\KnowledgeTimeline` (route /timeline): chronological knowledge events (problem discovered / fixed / escalated / fix undone / knowledge consulted) from incidents + recall events. `Memory\KnowledgeInsights` (route /insights): recurring problems (signature counts + fix success), coverage gaps (platforms with no archived knowledge), stale watch items (open > 24h). Honest "nothing yet" states. Feature tests.

### Task 6: Navigation + Reliability regrouping + purpose strips
Sidebar: Overview / **Knowledge** (Knowledge, Timeline, Insights) / **Reliability** (SLA dashboard, Indexes, Durability) / Account. Add a one-paragraph plain-language purpose strip atop each Reliability page. Update Jetstream navigation-menu fallback links. Route names stable.

### Task 7: Ship
pint + analyzers on diff; full suite; wiki.md changelog entry recording the redesign + doctrine carve-out; PR; deploy via deploy.yml; verify live pages render with the real production archive.
