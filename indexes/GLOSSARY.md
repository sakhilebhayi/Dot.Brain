---
title: Dot.Brain Glossary
version: 1.0.2
status: active
owners: [Chief Knowledge Engineer, Repository Steward Agent]
reviewing-agent: Documentation Agent
last-review: 2026-08-01
review-cadence: quarterly
---

# GLOSSARY

Purpose: one definition per term, ecosystem-wide. Each entry names its **canonical document** — the glossary summarizes; the canonical document defines. If they disagree, the canonical document wins and this file gets a fix PR.

> **Related documents:** [INDEX.md](INDEX.md) · [CROSSREF.md](CROSSREF.md) · [../README.md](../README.md)

---

## A–C

| Term | Definition | Canonical |
|---|---|---|
| **Aggregation floor (n ≥ 20)** | No claim may be made about a cohort of fewer than 20 identifiable people; counted by distinct contributors, with intersection-attack checks | [../brain.governance.md](../brain.governance.md) §6, operationalized [../brain.community.md](../brain.community.md) §3 |
| **Analysis pack** | DKP carrying an analytical finding: question, method, data window, cohort + floor check, confidence, mandatory confounds | [../brain.analytics.md](../brain.analytics.md) §3 |
| **Capability URL** | Unguessable evidence link embedded in a Brain PR; serves frozen-at-PR-open chain + current diff; PR lifetime + 1 year | [../brain.api.md](../brain.api.md) §4 |
| **Causal bar** | Requirements to promote `OBSERVED_WITH` to `CAUSES`: input ≥ 0.70, mechanism Why block, experiment or expert evidence, Reasoning Agent only | [../brain.relationships.md](../brain.relationships.md) §4.2 |
| **Classification levels** | `public → ecosystem → restricted → sensitive`; labels travel with knowledge; most-restrictive propagation on derived nodes | [../brain.security.md](../brain.security.md) §2 |
| **Confidence** | Node: source_trust × validation × corroboration × age_decay. Chain/edge: min(inputs) × factors. ≥ 0.80 recommendable, 0.50–0.79 provisional, < 0.50 dormant | [../brain.dkp.md](../brain.dkp.md), edges [../brain.relationships.md](../brain.relationships.md) |
| **Contradiction (CONTRADICTS)** | Active conflict edge; applies ×0.70 to affected confidence until resolved; opened at Δ ≥ 0.20 per ADR-0004 | [../brain.relationships.md](../brain.relationships.md), [../adr/ADR-0004](../adr/) |
| **Corroboration factor** | ×1.10 per independent source, capped at 1.30; community reputation may feed this, never trust | [../brain.dkp.md](../brain.dkp.md), reputation rule [../brain.community.md](../brain.community.md) §4 |
| **Crypto-shredding** | Legal erasure by provable destruction of a per-subject data-encryption key; `sensitive` fields only; leaves `[erased: legal]` markers | [../adr/ADR-0009-crypto-shredding-legal-erasure.md](../adr/ADR-0009-crypto-shredding-legal-erasure.md) |
| **Cushion dimension** | A named, independently-real business shock-absorption metric (e.g. reserve runway, payment reliability); never combined into one composite score across unlike dimensions; a dimension with no real underlying data renders as `insufficient_data`, never a fabricated number | [../brain.cushion.md](../brain.cushion.md) |

## D–G

| Term | Definition | Canonical |
|---|---|---|
| **DKP (Dot Knowledge Pack)** | Signed, versioned, schema-validated unit of knowledge exchange — the only way anything enters the Brain | [../brain.dkp.md](../brain.dkp.md) |
| **Dopamine gate** | W4 ethics gate run by the Dopamine Agent: five-point checklist + proxy-laundering trace; reject-never-edit | [../brain.governance.md](../brain.governance.md) §5 (checklist), [../brain.dopemine.md](../brain.dopemine.md) (policy) |
| **Dot.Charts vs. dashboards** | Dot.Charts is the AI-powered *trading* platform; visual charts/dashboards are Dot.Analytics views rendered by Dot.Design components — the name never refers to visualization | [../platforms/dot-charts.md](../platforms/dot-charts.md), views [../platforms/dot-analytics.md](../platforms/dot-analytics.md) |
| **Dormant** | Knowledge below 0.50 confidence: retained, searchable, unusable as inference input | [../brain.dkp.md](../brain.dkp.md), [../brain.reasoning.md](../brain.reasoning.md) |
| **Engagement-metric prohibition** | Session time, open counts, scroll depth, notification CTR, streak length, etc. may be measured but never optimized as targets | [../brain.dopemine.md](../brain.dopemine.md) §1–2 |
| **Ethics gate checklist** | Five questions (human-outcome target? not prohibited? guard declared? user benefit? visible + opt-out?); any "no" ⇒ rejection | [../brain.governance.md](../brain.governance.md) §5 |
| **Fact hierarchy** | Facts → Observations → Insights → Hypotheses → Recommendations; speculation is never presented as fact regardless of how confidently phrased | [../brain.market_intelligence.md](../brain.market_intelligence.md) §1 |
| **Golden signals** | Latency, traffic, errors, saturation per pipeline stage; definitions owned by telemetry | [../brain.telemetry.md](../brain.telemetry.md) §2 |
| **Guard metric** | Paired harm-detection metric a recommendation must declare; breach auto-opens an incident and retro-flags the gate decision | [../brain.metrics.md](../brain.metrics.md) §5, [../brain.dopemine.md](../brain.dopemine.md) §5 |

## H–M

| Term | Definition | Canonical |
|---|---|---|
| **Hot / Warm / Cold** | Memory tiers: ≤ 50 ms (90-day window, lessons always hot) / ≤ 2 s / ≤ 5 min immutable | [../brain.memory.md](../brain.memory.md) |
| **Inference rules (I1–I7)** | Aggregation ·95, correlation ·80, causal promotion ·95, analogy ·60 candidate-only, contradiction, temporal projection ·70, lesson application ·90 | [../brain.reasoning.md](../brain.reasoning.md) |
| **Ledger** | Append-only hash-chained audit record; T0 tier (RTO 1 h, RPO 0); ledger-before-graph, ledger-before-action invariants | [../adr/ADR-0006-audit-ledger-design.md](../adr/ADR-0006-audit-ledger-design.md), [../brain.workflows.md](../brain.workflows.md) |
| **Lesson** | Incident-derived knowledge; never decays (λ = 0); always hot; propagation ≤ 72 h | [../brain.learning.md](../brain.learning.md) Loop D, [../brain.resilience.md](../brain.resilience.md) |
| **Loops A–D** | Learning loops: trust calibration / conclusion calibration (overrides double-weight) / explanation templates / lessons | [../brain.learning.md](../brain.learning.md) |
| **Measure vs. optimize** | Engagement signals are legitimate observations (telemetry, guards) and prohibited optimization targets | [../brain.dopemine.md](../brain.dopemine.md) §1 |

## N–R

| Term | Definition | Canonical |
|---|---|---|
| **Never-forget set** | Knowledge exempt from all forgetting: lessons, ledger, active contradictions | [../brain.memory.md](../brain.memory.md) |
| **Persona** | Rendering register (`engineer`/`operator`/`executive`/`auditor`); changes presentation depth, never content truth | [../brain.personas.md](../brain.personas.md) |
| **PR Generator** | W5: the Brain's only write path to platforms — opens PRs with open-PR-only tokens; "Dot.Brain proposes; you decide" | [../brain.workflows.md](../brain.workflows.md) §5 |
| **Promotion gate (telemetry → metric)** | Five steps: named decision, statable commitment, 8-field registration, dopamine check, attached baseline | [../brain.telemetry.md](../brain.telemetry.md) §4 |
| **Proxy laundering** | Disguising a prohibited engagement target as a legitimate-sounding metric; caught by causal-ancestry trace | [../brain.dopemine.md](../brain.dopemine.md) §3 |
| **Reputation ≠ trust** | Community standing may corroborate claims but never sets trust scores; contamination is an incident | [../brain.community.md](../brain.community.md) §4 |
| **Research memory** | Persisted, non-expired findings keyed by topic + market; a new research request must reuse a valid match before fetching anything (reuse-before-research cost discipline) | [../brain.market_intelligence.md](../brain.market_intelligence.md) §2, §4 |
| **RTO/RPO tiers (T0–T3)** | Recovery commitments: ledger 1 h/0 · graph 4 h/5 min · 12 h/1 h · indexes 48 h/24 h (disposable) | [../adr/ADR-0007-rto-rpo-tier-model.md](../adr/ADR-0007-rto-rpo-tier-model.md) |

## S–Z

| Term | Definition | Canonical |
|---|---|---|
| **SAME_AS candidate** | Similarity-suggested (≥ 0.90) term/node equivalence; never auto-merged — false merges silently pool evidence across concepts | [../brain.semantic.md](../brain.semantic.md) §3 |
| **Similarity suggests, evidence asserts** | Semantic-layer rule: embedding proximity produces candidates only; no edge or confidence from similarity alone | [../brain.semantic.md](../brain.semantic.md) §1 |
| **Supersession (SUPERSEDES)** | The only way to change knowledge meaning — new version, old retained; also the metric-redefinition rule | [../brain.relationships.md](../brain.relationships.md), [../brain.metrics.md](../brain.metrics.md) §2 |
| **T0–T4 (approval tiers)** | Human-approval escalation levels for colony actions; T4 = named human sign-off | [../brain.governance.md](../brain.governance.md) |
| **Topic taxonomy** | Hierarchical `<domain>.<topic>.<subtopic>` terms; ≥ 2-platform terms frozen against rename | [../brain.semantic.md](../brain.semantic.md) §2 |
| **Trust score** | Per agent/source: 0.5·accuracy + 0.3·review + 0.2·(1−incidents); starts 0.50; step cap ±0.05/month | [../brain.agents.md](../brain.agents.md), [../brain.learning.md](../brain.learning.md) Loop A |
| **W1–W6** | Workflow pipeline: ingest → graph → reason → gates → PR generation → outcome ingestion | [../brain.workflows.md](../brain.workflows.md) |
| **Why block** | Human-readable reasoning record on every conclusion/recommendation; comprehension target ≥ 4/5 | [../brain.reasoning.md](../brain.reasoning.md), rendering [../brain.api.md](../brain.api.md) §5 |

Spelling note: the *file/platform* is **Dopemine** (brain.dopemine.md, Dot.Dopemine); the *agent* is the **Dopamine Agent**. Deliberate, not a typo.

---

## Change Log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-08-01 | Brain Document Generator (prompt 03, AI) | Initial glossary: 34 canonical terms across the 21 published brain documents (closes F-04, part 1) |
| 1.0.1 | 2026-08-01 | Repository Reviewer (prompt 07, AI) | Added "Dot.Charts vs. dashboards" disambiguation entry |
| 1.0.2 | 2026-08-08 | Truth-reconciliation pass | Added "Cushion dimension", "Fact hierarchy", "Research memory" — terms brain.cushion.md and brain.market_intelligence.md defined but never registered here |

## Open Questions

| Question | Owner → Approver |
|---|---|
| Should glossary terms be exported as taxonomy seed terms once schemas/taxonomy.json is decided (see brain.semantic.md open question)? | Knowledge Agent → Chief Knowledge Engineer |
