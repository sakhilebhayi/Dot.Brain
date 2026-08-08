# Autonomy Score

Computes the Autonomy Score (`../../brain.autonomy.md` §3) per entity from
`../../platforms/autonomy-signals.json`'s real, code-audited signals.
Binary per-category formulas only -- see `../../docs/superpowers/specs/2026-08-08-autonomy-score-design.md`
for the full formula table and the one-signal-per-category rule that
prevents double-counting.

## Usage

```bash
node src/cli.js report                    # every entity, full breakdown
node src/cli.js report --entity=dot-finance   # one platform
node src/cli.js report --entity=dot       # 29-platform average + Dot.Brain's own score, shown separately
```

## What's implemented

Binary category scoring (100 or 0, never a fabricated continuous value)
for all 11 `brain.autonomy.md` §3 categories, per-platform and ecosystem-
average reporting, explicit reasons printed for every 0.

## What's NOT implemented

- No dashboard/UI -- CLI text output only.
- No re-auditing -- `autonomy-signals.json` is a snapshot of the
  2026-08-08 platform audits; scores go stale as the real ecosystem
  changes until a future sub-project re-audits and updates that file.
- No autonomy interval/gate computation (`brain.autonomy.md` §5) --
  that needs incident/security-failure tracking this service doesn't have.
