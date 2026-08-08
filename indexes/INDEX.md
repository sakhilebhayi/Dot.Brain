---
title: Dot.Brain Master Navigation Index
version: 1.2.0
status: active
owners: [Chief Intelligence Architect, Repository Steward Agent]
last-review: 2026-08-01
---

# INDEX — Master Navigation

Purpose: persona-based navigation for the entire Dot.Brain repository, so any reader finds any document in under a minute.

> **Related documents:** [../README.md](../README.md) · [GLOSSARY.md](GLOSSARY.md) · [CROSSREF.md](CROSSREF.md)

---

## Reading Orders by Persona

### 🛠 Platform Engineer (integrating a platform)
1. [../README.md](../README.md) — boundary & interaction model
2. [../brain.dkp.md](../brain.dkp.md) — how to publish Knowledge Packs
3. [../brain.platforms.md](../brain.platforms.md) — register your platform
4. [../brain.api.md](../brain.api.md) · [../brain.events.md](../brain.events.md) — contracts
5. [../brain.workflows.md](../brain.workflows.md) — ingestion → recommendation → PR flow
6. Your platform doc in [../platforms/](../platforms/) · schemas in [../schemas/](../schemas/)

### 🤖 AI Agent (operating within the Colony)
1. [../brain.agents.md](../brain.agents.md) — your duties and boundaries
2. [../brain.reasoning.md](../brain.reasoning.md) · [../brain.semantic.md](../brain.semantic.md) — inference & ontology
3. [../brain.relationships.md](../brain.relationships.md) · [CROSSREF.md](CROSSREF.md) — graph model
4. [../brain.learning.md](../brain.learning.md) · [../brain.experiments.md](../brain.experiments.md)
5. [../brain.recommendations.md](../brain.recommendations.md) — how proposals become PRs
6. [../brain.governance.md](../brain.governance.md) — what requires human approval

### 📈 Executive
1. [../brain.identity.md](../brain.identity.md) · [../brain.vision.md](../brain.vision.md)
2. [../MANIFESTO.md](../MANIFESTO.md)
3. [../brain.business.md](../brain.business.md) · [../brain.analytics.md](../brain.analytics.md) · [../brain.metrics.md](../brain.metrics.md)
4. [../brain.cushion.md](../brain.cushion.md) — shock-absorption capacity per platform · [../brain.market_intelligence.md](../brain.market_intelligence.md) — how research becomes decisions
5. [../brain.future.md](../brain.future.md) — what's next

### 🔐 Security Reviewer
1. [../brain.security.md](../brain.security.md) — threat model & controls
2. [../brain.governance.md](../brain.governance.md) — approval chains & audit
3. [../brain.telemetry.md](../brain.telemetry.md) — observability & audit trails
4. [../brain.resilience.md](../brain.resilience.md) · [../brain.failures.md](../brain.failures.md)
5. [../schemas/](../schemas/) — validation boundaries

### 🌱 New Contributor
1. [../README.md](../README.md) — start here
2. [../MANIFESTO.md](../MANIFESTO.md) — the principles
3. [GLOSSARY.md](GLOSSARY.md) — the vocabulary
4. [../os/01-Executive-Vision.md](../os/01-Executive-Vision.md) — what the whole ~20-platform ecosystem is, one level above Dot.Brain itself
5. [../brain.operating_model.md](../brain.operating_model.md) — how humans and agents work together within Dot.Brain
6. [../templates/](../templates/) — how to write anything here
7. [../adr/ADR-0001-repository-structure.md](../adr/ADR-0001-repository-structure.md) · [../adr/ADR-0012-ecosystem-operating-system-layer.md](../adr/ADR-0012-ecosystem-operating-system-layer.md) — why it's shaped this way

## Full Document Catalog (by domain group)

| Group | Documents |
|---|---|
| Ecosystem Operating System | [os/](../os/README.md) — 20 docs + Appendix, one level above brain.*.md; ecosystem-wide doctrine, not Dot.Brain-internal |
| Identity & Direction | brain.identity, brain.vision, brain.future, MANIFESTO |
| Architecture | brain.architecture, brain.patterns, brain.api, brain.events, brain.workflows, adr/ |
| Intelligence | brain.reasoning, brain.learning, brain.memory, brain.semantic, brain.recommendations, brain.evolution, brain.experiments |
| Knowledge Exchange | brain.dkp, brain.platforms, brain.relationships, platforms/, schemas/ |
| Operations & Trust | brain.security, brain.telemetry, brain.governance, brain.resilience, brain.cushion, brain.failures, brain.operating_model |
| People & Value | brain.personas, brain.design, brain.community, brain.dopemine, brain.business, brain.analytics, brain.metrics, brain.success, brain.market_intelligence |
| Agents | brain.agents |
| Navigation | INDEX, GLOSSARY, CROSSREF |
| Runnable Services | services/ — Dot.Brain's own reference implementations of a brain.*.md contract (currently: market-research) |

---

## Change Log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-08-01 | Repository Architect (prompt 01) | Initial persona-based navigation index |
| 1.1.0 | 2026-08-01 | Repository Steward Agent | Added os/ (Ecosystem Operating System) to New Contributor path and Full Document Catalog |
| 1.2.0 | 2026-08-08 | Truth-reconciliation pass | Registered brain.cushion.md and brain.market_intelligence.md (Executive reading order + Full Document Catalog); added Runnable Services row for services/ |

## Open Questions

- Add an "SRE / Operator" persona once brain.resilience.md content lands (prompt 06)?
