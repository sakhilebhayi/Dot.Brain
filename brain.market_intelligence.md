---
title: Dot.Brain — Market Intelligence (External Research Layer)
version: 1.0.1
status: active
owners: [Platform Integrator]
last-review: 2026-08-10
---

# brain.market_intelligence — Market Intelligence (External Research Layer)

Purpose: the shared contract for the ecosystem's outward-looking research
capability — how any Dot platform (or a human operator) turns a real
external source (a web page, an RSS feed, a public GitHub repository) into
a structured, reusable, honestly-sourced finding, and how those findings
are stored so the same research is never redone from scratch. This is
Dot.Brain's first capability with real runnable code
(`services/market-research/`) rather than documentation alone — see §6 for
why that's a deliberate, not accidental, step.

**Scope of this version:** the research capability and its memory schema
only — zero-setup sources (web, RSS, public GitHub). Content-intelligence
pipelines, the competitive-intelligence framework, and cross-platform
marketing-opportunity discovery are named as future extensions (§7) but
not built in this version.

> **Related documents:** [brain.dkp.md](brain.dkp.md) — the pattern this
> follows for shared-contract-plus-per-implementation ecosystem
> capabilities · [brain.cushion.md](brain.cushion.md) — the most recent
> prior example of this same pattern (a shared contract, implemented
> per-platform) · [brain.governance.md](brain.governance.md) — the
> broader audit/review cadence this capability's findings feed into ·
> [brain.dopemine.md](brain.dopemine.md) — the ethical-engagement rules
> any content this research informs must still honor.

---

## 1. The fact hierarchy (never present speculation as fact)

Every finding is explicitly tagged with exactly one of:

1. **Fact** — directly, verifiably true as stated by a primary source (a company's own pricing page, a GitHub repo's own README, an official statistics release).
2. **Observation** — a directly measured or directly read data point, not yet interpreted (e.g. "Competitor X's homepage lists 4 pricing tiers as of 2026-08-08").
3. **Insight** — an interpretation of one or more observations (e.g. "Competitor X appears to be targeting SMEs based on its lowest tier's feature set").
4. **Hypothesis** — an untested explanatory guess, explicitly labeled as unverified (e.g. "Competitor X may be preparing an enterprise tier given recent job postings for enterprise sales roles").
5. **Recommendation** — an action suggested on the basis of the above, always citing which facts/observations/insights/hypotheses it rests on.

A finding's tag is never upgraded without new evidence. A hypothesis stays a hypothesis until something confirms or refutes it — confirmation doesn't happen by repetition or confidence inflation.

## 2. Research-memory schema

Every finding, regardless of source or channel, is stored with:

| Field | Type | Notes |
|---|---|---|
| `id` | string (UUID) | |
| `source` | string (URL or identifier) | The exact origin — a URL, a repo path, an RSS feed item link |
| `date` | ISO 8601 datetime | When the source content was published/observed, not when it was fetched, when knowable; falls back to fetch time with that distinction noted |
| `topic` | string | What was being researched (free text, but consistent enough to dedup against) |
| `market` | string | Geography/segment scope — `"South Africa"`, `"Africa"`, `"Global"`, etc. (§4) |
| `tier` | enum | `fact` \| `observation` \| `insight` \| `hypothesis` \| `recommendation` (§1) |
| `finding` | string | The actual content, one falsifiable statement per row (matching the DKP `insight` payload's own discipline) |
| `confidence` | number, 0.00–1.00 | Calibrated to the tier — a `fact` from a primary source can be high; a `hypothesis` should rarely exceed 0.5 |
| `supporting_evidence` | array of strings | Sub-references (specific page sections, quotes, data points) backing the finding |
| `related_dot_platform` | string, nullable | Which platform this is most relevant to, if any |
| `recommended_action` | string, nullable | Only populated for `recommendation`-tier rows |
| `expiry_date` | ISO 8601 date | When this finding should be treated as stale and re-verified before reuse — required, not optional; rapidly-changing markets get short expiries, stable facts get long ones |
| `fetched_at` | ISO 8601 datetime | |
| `status` | enum | `structured` \| `pending_extraction` (§5) |

Low-value or purely temporary information (a single day's stock price, a transient homepage A/B test) is not written to memory at all — the schema exists to avoid re-researching genuinely reusable findings, not to log everything ever fetched.

## 3. Governance (built in, not bolted on)

- **Respect access restrictions.** Every web fetch checks `robots.txt` before requesting a page; a disallowed path is skipped, not worked around.
- **No credential bypass, ever.** This capability only touches publicly-accessible content — no login flows, no cookie storage, no CAPTCHA-solving. (This is also why login-gated social channels are explicitly out of scope for this version — see the Agent Reach discussion this design followed from.)
- **Every claim traces to a source.** `source` and `fetched_at` are required on every row — no exceptions.
- **Primary vs. commentary.** A company's own stated pricing is a `fact` from a primary source; a blog post's claim about that company's pricing is, at best, an `observation` about what the blog post says, not a `fact` about the pricing itself.
- **Conflicting information is flagged, not silently resolved.** If a new finding contradicts an existing one on the same topic, both are kept, both are visible, and neither is auto-deleted — a human or a later, more authoritative source resolves the conflict.
- **Recency preference for volatile topics.** Findings expire (§2's `expiry_date`); reuse-before-research (§4) always checks expiry before treating a stored finding as current.
- **Never fabricate missing research.** If a source can't be found or a fetch fails, the gap is reported as a gap — never filled with a plausible-sounding invention.

## 4. Cost discipline: reuse before research

Before any fetch happens, the research memory is checked for an existing, non-expired finding on the same `topic` + `market`. Only the genuinely missing pieces are researched. This is enforced in code (§6), not left as a suggestion — `cli.js research` always checks memory first and reports what it reused versus what it actually fetched.

South-Africa-first sequencing (per the original request this design follows from): `market` values default to South African scope before broadening to `"Africa"` or `"Global"` — a topic is researched at the narrowest relevant scope first, and only widened when the narrower scope's findings are insufficient or the topic is explicitly cross-border.

## 5. Structured extraction is pluggable, and honest about its dependency

Turning raw fetched content into schema-shaped findings (§2) requires an LLM extraction step. This service calls the Anthropic API for that step **only when `ANTHROPIC_API_KEY` is configured**. When it isn't, a fetch still succeeds and is still stored — as a `status: 'pending_extraction'` row with the raw captured content, not silently dropped and not faked into a structured shape it hasn't actually earned. A human or an agent with LLM access (the same discipline this whole document asks the automated extractor to follow) can process these rows later.

## 6. Why this lives in Dot.Brain, and why it's the first real code here

Every other Dot.Brain document is knowledge — prose, schemas, templates. This is the first genuine capability: runnable code any platform can invoke, rather than a contract each platform re-implements in its own stack (contrast with `brain.dkp.md`/`brain.cushion.md`, where the *pattern* is shared but the *code* is duplicated per-platform because each platform is a separate deployed application). Market/competitive research isn't naturally owned by any one platform's data model the way a resilience metric is — it's genuinely ecosystem-level, which is why it's hosted here instead of picked as a per-platform pilot.

Node.js was chosen as the runtime because it's the one precedent already established in this ecosystem for "Dot.Brain needs to actually execute something" (Dot.Billing's real DKP key generation used Node for exactly this reason — no PHP/sodium runtime exists in this environment either).

## 7. Explicitly out of scope for this version

- Login-gated social/community channels (Twitter/X, Reddit, LinkedIn, Facebook, Instagram) — credential and ToS risk, per the design discussion this followed from.
- YouTube transcript research — needs a dedicated library/API not present in this runtime yet; named here so it isn't silently assumed to work.
- The content-intelligence pipeline (turning findings into blog posts, campaigns, etc.) — a future extension building on this memory layer.
- The competitive-intelligence framework (the full company/product/pricing/positioning/complaints template) — a future extension using this same schema with a `competitor`-shaped `topic` convention.
- Cross-platform marketing-opportunity discovery (e.g. "a Dot.Mines customer may benefit from Dot.Analytics") — a future extension, likely reading `related_dot_platform` patterns across many findings.
- Automatic scheduling/continuous monitoring — this version is invoked on-demand (`cli.js research ...`), not a running background loop.

## Change Log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-08-08 | Platform Integrator | Initial shared contract: fact hierarchy, research-memory schema, governance rules, cost-discipline (reuse-before-research), pluggable/honest extraction step, and the rationale for Dot.Brain hosting real code for the first time. Scoped to zero-setup channels (web, RSS, public GitHub) only. |
| 1.0.1 | 2026-08-10 | Brain core-doc sweep | Status draft → active: `services/market-research/` is real, built, and manually verified (package.json, memory/robots/fetchWeb/fetchRss/fetchGithub/extract/cli.js, README, test), not a proposal. |

## Open Questions

| Question | Owner → Approver |
|---|---|
| Should structured findings ever get promoted from the local SQLite memory store into a committed, reviewable document (mirroring how a verified DKP insight becomes durable knowledge), or does raw research memory stay permanently ephemeral/local? | Platform Integrator → Governance Agent |
| Who reviews and expires stale findings at scale once multiple platforms are actually calling this service — a scheduled job, or manual review per `brain.governance.md`'s cadence? | Platform Integrator → Governance Agent |
