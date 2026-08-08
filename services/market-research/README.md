# services/market-research

Dot ecosystem external research capability. Implements
[../../brain.market_intelligence.md](../../brain.market_intelligence.md) --
read that first for the full contract (fact hierarchy, schema, governance,
cost discipline).

## Setup

No install step beyond Node.js itself (v22.5+, for `node:sqlite`). No npm
dependencies.

Optional: set `ANTHROPIC_API_KEY` in your shell environment for real
structured extraction. Without it, fetched content is stored as raw
`pending_extraction` captures -- never faked into a structured shape.

## Usage

```bash
node src/cli.js research "South African mining software market" \
  --market="South Africa" \
  --platform="dot-mines" \
  --urls="https://example.com/some-real-page" \
  --channels=github
```

Always checks local research memory (`data/research.sqlite`, gitignored)
for a valid, non-expired finding on the same topic+market before fetching
anything.

## What's implemented

- Web page fetching (robots.txt-respecting, plain-text extraction)
- RSS feed fetching (lightweight RSS 2.0 `<item>` parser)
- Public GitHub repository search (no auth)
- SQLite-backed research memory with dedup-before-research
- Pluggable LLM extraction (Anthropic API if `ANTHROPIC_API_KEY` is set;
  honest raw-capture fallback otherwise)

## What's not implemented (see brain.market_intelligence.md §7)

- Login-gated social/community channels (Twitter/X, Reddit, LinkedIn,
  Facebook, Instagram) -- credential and ToS risk, out of scope by design.
- YouTube transcript research.
- Content-intelligence, competitive-intelligence, and cross-platform
  marketing-opportunity pipelines -- future extensions on this memory
  layer, not built yet.
- Scheduled/continuous monitoring -- this is invoked on-demand only.
