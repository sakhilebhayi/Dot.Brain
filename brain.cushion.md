---
title: Dot.Brain — The Cushion (Business Resilience Visibility)
version: 1.0.0
status: draft
owners: [Platform Integrator]
last-review: 2026-08-08
---

# brain.cushion — The Cushion (Business Resilience Visibility)

Purpose: the shared contract for a cross-ecosystem, user-facing feature — each Dot platform surfacing a business's own capacity to absorb a shock, in whichever real dimensions that platform can honestly compute from data it already collects. This is deliberately **not** the same document as [brain.resilience.md](brain.resilience.md), which is Dot.Brain's own SRE/incident-continuity framework (Prevention → Detection → Response → Recovery → Learning); "the cushion" here is a *business owner-facing* concept, unrelated to system uptime or disaster recovery. The name comes from marketing/vision copy commissioned for the ecosystem: a business's reserves, capacity, and diversity — together, its ability to fall without disappearing.

> **Related documents:** [brain.dkp.md](brain.dkp.md) §1.4 — the `metric` payload type, which a later extension of this contract could reuse to publish cushion dimensions as cross-platform intelligence (out of scope for this version) · [brain.dopemine.md](brain.dopemine.md) — the ethical-engagement rules this feature must not violate · each platform's own `wiki.md` — where a platform's actual implemented cushion dimension(s) are documented, per platform, as they ship.

---

## 1. What this is, and isn't

**Is:** a shared vocabulary and a shared honesty discipline for a feature where a platform shows its own users a real, computed number (or small set of numbers) describing their business's capacity to absorb a shock — e.g. "approximately 8 months of operating capacity at the current burn rate."

**Isn't:**
- A composite, single "resilience score" combining unlike dimensions (cash runway + customer concentration + staffing capacity, etc.) into one number. Combining incommensurable things manufactures false precision and false comparability — each dimension stands alone, reported with its own unit and computation basis.
- A cross-platform published signal (yet). This version is scoped to each platform showing its *own* users their *own* numbers, computed from that platform's *own* data. Publishing aggregate cushion metrics as Knowledge Packs (reusing the `metric` payload type and the DKP pipeline pattern proven on Dot.Charts) is a natural later extension, not part of this contract.
- An automation or action-taking feature. Purely informational — visibility, not auto-adjusted budgets or auto-triggered anything.
- A dopamine mechanic. No streaks, no badges, no leaderboards, no urgency-manufacturing framing. A low cushion number is disclosed factually, the same way a losing backtest period is disclosed on Dot.Charts — never softened, never gamified.

## 2. The core honesty rule

**A platform shows a cushion dimension only if it can compute it from real, already-collected data.** No placeholder numbers, no "coming soon" fake previews, no estimates dressed up as measurements. If a platform's data model doesn't support a dimension yet, that dimension simply isn't shown on that platform — not shown as zero, not shown as "N/A" styled to look like a real metric, just absent.

Every shown number states its computation basis in one line (mirroring Dot.Charts' `DisclosureFormatter` attribution pattern) — what data, what formula, as of when.

Prefer honest imprecision over false precision: "approximately 8 months" when the underlying balance is a manually-maintained account figure, not "8.02 months" implying a rigor the input data doesn't have.

## 3. Resilience Dimension Registry (shared vocabulary)

A dimension entering this table does not imply any platform has built it — this registry exists so that when two platforms *do* independently build a related dimension, they use the same name and the same unit, rather than each platform's `wiki.md` describing the same concept three different ways.

| Dimension | Definition | Unit | Real anywhere yet? |
|---|---|---|---|
| `reserve_runway` | Months of operating capacity at current burn rate, computed from account balances and recent expense trend | months | **Dot.Finance** (pilot, this round) |
| `payment_reliability` | Rate of on-time/successful payments vs. invoices issued, over a trailing window | percent | **Dot.Billing** (pilot, this round) |
| `customer_concentration` | Share of revenue or usage from the top-N customers/accounts | percent | Not yet implemented anywhere |
| `supplier_concentration` | Share of a critical input sourced from a single supplier | percent | Not yet implemented anywhere |
| `institutional_knowledge_concentration` | Share of a critical process/workflow understood by only one person | percent | Not yet implemented anywhere |
| `operational_capacity_margin` | Unused capacity as a share of total capacity | percent | Not yet implemented anywhere |

New dimensions get added to this table by whichever platform builds the first real implementation of them — the registry entry and the first real implementation ship together, never a registry entry alone (avoids the "aspirational schema field nobody implements" pattern already found and flagged in the DKP classification field, §Context of ChartSense's own `2026-08-08-knowledge-pack-publishing-i3-inbound-gate.md` design).

## 4. UI pattern (shared shape, platform-adapted content)

A "Cushion" card/section on the platform's own dashboard:

1. **Headline metric** — the number, in its real unit, with the dimension's plain-language name (not the `snake_case` registry key).
2. **Computation basis** — one line: what data, what formula, as of when.
3. **What-if scenario** (only when the underlying data genuinely supports computing one — never fabricated to fill the slot) — e.g. "Losing your largest customer would reduce this from 8 months to 5." If no real what-if is computable, this section is omitted, not filled with a placeholder.
4. **Trend** (only when historical data exists to show one) — is this dimension improving or worsening over the recent period, described factually, not with alarmist or celebratory framing.

## 5. Explicitly out of scope for this contract

- DKP publication of cushion dimensions (a later extension).
- A composite/aggregate resilience score.
- Automated actions triggered by a cushion number.
- Cross-platform aggregation of one business's cushion across multiple Dot platforms it uses (e.g. combining Dot.Finance's reserve runway with Dot.Billing's payment reliability into one "ecosystem cushion view") — each platform's cushion feature stands alone in this version; a unified cross-platform view would need real data-sharing infrastructure between platforms that doesn't exist.
- Dimensions not backed by real, already-collected data on the platform showing them.

## Change Log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-08-08 | Platform Integrator | Initial shared contract: dimension registry (2 real pilots — Dot.Finance reserve_runway, Dot.Billing payment_reliability — 4 named-but-unimplemented), honesty rule, UI pattern, explicit scope boundary against brain.resilience.md's unrelated SRE-continuity meaning. |

## Open Questions

| Question | Owner → Approver |
|---|---|
| Should a later version add DKP publication of cushion dimensions (reusing the `metric` payload type proven on Dot.Charts), and if so, under what `domain` name given `resilience` is already Dot.Brain's own SRE-continuity domain? | Platform Integrator → Chief Architect |
| Who owns approving new Resilience Dimension Registry entries as more platforms build real implementations — first-implementer-defines-it (current default) or a review step? | Platform Integrator → Governance Agent |
