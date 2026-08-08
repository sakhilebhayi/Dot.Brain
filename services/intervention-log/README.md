# Owner Intervention Log

Records when the owner had to act on something a Dot ecosystem entity was
expected to handle autonomously. See `../../brain.autonomy.md` §8 for the
full contract this implements.

## Usage

```bash
npm install  # first time only, no dependencies to fetch but sets up node_modules/
node src/cli.js log --entity="Dot.Finance" --category=routine \
  --problem="Reserve runway dashboard showed stale data" \
  --trigger="Owner noticed the number had not changed in 3 days" \
  --root-cause="Scheduled recompute job was never wired to a cron entry" \
  --why-automation-failed="This was never automated -- the recompute was always manual" \
  --recommended-solution="Add a daily scheduled task that recomputes and caches the value" \
  --logged-by=session

node src/cli.js list --entity="Dot.Finance"
node src/cli.js streak
```

## What's implemented

- `log` — records one intervention. All of `entity`, `category`, `problem`,
  `trigger`, `root-cause`, `why-automation-failed`, `recommended-solution`,
  `logged-by` are required; `platform`, `decision-required`,
  `time-spent-minutes` are optional.
- `list` — chronological view, optionally filtered by `--entity` and/or
  `--since` (ISO date, matches on `occurred_at`).
- `streak` — current and longest consecutive-days-without-a-routine-entry,
  optionally scoped to one `--entity`. An empty log reports `0`/`0` rather
  than a fabricated streak.

## What's NOT implemented

- No Autonomy Score computation — that requires real per-category signals
  this service doesn't produce (see `brain.autonomy.md` §3).
- No dashboard or UI — this is a CLI only.
- No automatic detection of interventions — every entry is asserted by a
  Claude session or the owner; nothing here infers that an intervention
  happened.
