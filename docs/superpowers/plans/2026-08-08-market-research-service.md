# services/market-research/ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the real, runnable research capability specified in [brain.market_intelligence.md](../../brain.market_intelligence.md) — Dot.Brain's first executable code. Zero-setup channels only (web, RSS, public GitHub); dedup-before-research; honest pluggable LLM extraction.

**Architecture:** A Node.js CLI (`cli.js`) orchestrates: check research memory (SQLite, via `node:sqlite`) for a valid non-expired finding first; if missing, fetch from the appropriate channel (`fetchWeb.js`/`fetchRss.js`/`fetchGithub.js`, each robots.txt-respecting where relevant); attempt structured extraction (`extract.js`, calls Anthropic API only if `ANTHROPIC_API_KEY` is set, else stores a `pending_extraction` row); persist via `memory.js`.

**Tech Stack:** Node.js (v18+ for global `fetch`; this environment has v24). `node:sqlite` (built-in, experimental — no external dependency) for persistence. `node:test` + `node:assert` (built-in) for tests. No npm dependencies beyond what's already in the Node runtime — matching "install only required dependencies."

## Global Constraints

- Every finding row includes `source`, `fetched_at`, `tier`, `confidence`, `expiry_date` — no exceptions, no partial rows (per `brain.market_intelligence.md` §2).
- `cli.js research` always checks memory for a valid, non-expired finding on the same `topic`+`market` before fetching anything (per §4's reuse-before-research).
- Web fetches check `robots.txt` first; a disallowed path is skipped (per §3).
- Without `ANTHROPIC_API_KEY`, fetched content is stored as `status: 'pending_extraction'` with the raw content preserved — never faked into a structured shape (per §5).
- Login-gated channels (Twitter/X, Reddit, LinkedIn, Facebook, Instagram, YouTube) are not implemented — no code path attempts them (per §7).
- `node:sqlite` is experimental in this Node version — every module using it is written so a future switch to a stable driver (e.g. `better-sqlite3`) only touches `memory.js`, not its callers.

---

### Task 1: `package.json` + `memory.js` (research-memory store)

**Files:**
- Create: `services/market-research/package.json`
- Create: `services/market-research/src/memory.js`
- Create: `services/market-research/.gitignore`
- Test: `services/market-research/test/memory.test.js`

**Interfaces:**
- Produces: `memory.js` exports `openMemory(dbPath)` (returns a memory handle), `findValid(memory, {topic, market})` (returns the newest non-expired matching row or `null`), `save(memory, findingRow)` (inserts one row, validating required fields per the schema), `listConflicts(memory, {topic, market})` (returns all rows for a topic/market pairing, for surfacing contradictions per §3) — consumed by Task 5's `cli.js`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@dot-brain/market-research",
  "version": "1.0.0",
  "description": "Dot ecosystem external market-research capability -- zero-setup channels (web, RSS, public GitHub), structured Facts->Observations->Insights->Hypotheses->Recommendations findings, reuse-before-research memory. See ../../brain.market_intelligence.md for the full contract.",
  "type": "module",
  "bin": {
    "market-research": "./src/cli.js"
  },
  "scripts": {
    "test": "node --experimental-sqlite --test test/"
  },
  "engines": {
    "node": ">=22.5.0"
  }
}
```

- [ ] **Step 2: Write `.gitignore`**

```
data/
node_modules/
.env
```

(`data/` holds the SQLite database file — working research memory, not committed knowledge, per `brain.market_intelligence.md`'s Open Questions on whether findings ever get promoted to committed docs — undecided, so default to not committing raw memory.)

- [ ] **Step 3: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { openMemory, findValid, save, listConflicts } from '../src/memory.js';

const TEST_DB = 'test/tmp-memory.sqlite';

function freshMemory() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  return openMemory(TEST_DB);
}

function validRow(overrides = {}) {
  const now = new Date().toISOString();
  return {
    source: 'https://example.com/page',
    date: now,
    topic: 'South African mining software market',
    market: 'South Africa',
    tier: 'observation',
    finding: 'Example finding text',
    confidence: 0.7,
    supporting_evidence: ['quote from page'],
    related_dot_platform: 'dot-mines',
    recommended_action: null,
    expiry_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    fetched_at: now,
    status: 'structured',
    ...overrides,
  };
}

test('save() persists a row and findValid() retrieves it', () => {
  const mem = freshMemory();
  save(mem, validRow());

  const found = findValid(mem, { topic: 'South African mining software market', market: 'South Africa' });
  assert.ok(found);
  assert.equal(found.finding, 'Example finding text');
});

test('findValid() returns null for a topic with no findings', () => {
  const mem = freshMemory();
  const found = findValid(mem, { topic: 'nonexistent topic', market: 'South Africa' });
  assert.equal(found, null);
});

test('findValid() ignores expired findings', () => {
  const mem = freshMemory();
  save(mem, validRow({ expiry_date: '2020-01-01' }));

  const found = findValid(mem, { topic: 'South African mining software market', market: 'South Africa' });
  assert.equal(found, null);
});

test('save() rejects a row missing a required field', () => {
  const mem = freshMemory();
  const row = validRow();
  delete row.source;

  assert.throws(() => save(mem, row), /source/);
});

test('listConflicts() returns all rows for a topic, including differing findings', () => {
  const mem = freshMemory();
  save(mem, validRow({ finding: 'Finding A' }));
  save(mem, validRow({ finding: 'Finding B', source: 'https://example.com/other-page' }));

  const rows = listConflicts(mem, { topic: 'South African mining software market', market: 'South Africa' });
  assert.equal(rows.length, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/market-research && node --experimental-sqlite --test test/memory.test.js`
Expected: FAIL — `memory.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

```js
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const REQUIRED_FIELDS = [
  'source', 'date', 'topic', 'market', 'tier', 'finding',
  'confidence', 'expiry_date', 'fetched_at', 'status',
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  date TEXT NOT NULL,
  topic TEXT NOT NULL,
  market TEXT NOT NULL,
  tier TEXT NOT NULL,
  finding TEXT NOT NULL,
  confidence REAL NOT NULL,
  supporting_evidence TEXT,
  related_dot_platform TEXT,
  recommended_action TEXT,
  expiry_date TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  status TEXT NOT NULL
);
`;

export function openMemory(dbPath) {
  const dir = dirname(dbPath);
  if (dir && dir !== '.' && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  return db;
}

export function save(memory, row) {
  for (const field of REQUIRED_FIELDS) {
    if (row[field] === undefined || row[field] === null || row[field] === '') {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  const stmt = memory.prepare(`
    INSERT INTO findings (id, source, date, topic, market, tier, finding, confidence, supporting_evidence, related_dot_platform, recommended_action, expiry_date, fetched_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    randomUUID(),
    row.source, row.date, row.topic, row.market, row.tier, row.finding, row.confidence,
    JSON.stringify(row.supporting_evidence ?? []),
    row.related_dot_platform ?? null,
    row.recommended_action ?? null,
    row.expiry_date, row.fetched_at, row.status
  );
}

export function findValid(memory, { topic, market }) {
  const today = new Date().toISOString().slice(0, 10);
  const stmt = memory.prepare(`
    SELECT * FROM findings
    WHERE topic = ? AND market = ? AND expiry_date >= ?
    ORDER BY fetched_at DESC
    LIMIT 1
  `);
  const row = stmt.get(topic, market, today);
  return row ?? null;
}

export function listConflicts(memory, { topic, market }) {
  const stmt = memory.prepare(`
    SELECT * FROM findings WHERE topic = ? AND market = ? ORDER BY fetched_at DESC
  `);
  return stmt.all(topic, market);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/market-research && node --experimental-sqlite --test test/memory.test.js`
Expected: PASS (all 5 tests). The `ExperimentalWarning: SQLite is an experimental feature` line on stderr is expected noise, not a failure.

- [ ] **Step 5: Commit**

```bash
git add services/market-research/package.json services/market-research/.gitignore services/market-research/src/memory.js services/market-research/test/memory.test.js
git commit -m "feat(market-research): add package scaffold and SQLite-backed research memory"
```

---

### Task 2: `robots.js` + `fetchWeb.js`

**Files:**
- Create: `services/market-research/src/robots.js`
- Create: `services/market-research/src/fetchWeb.js`
- Test: `services/market-research/test/fetchWeb.test.js`

**Interfaces:**
- Produces: `robots.js` exports `isAllowed(url)` (fetches and parses `robots.txt` for the URL's origin, returns `boolean`, defaults to `true` — allowed — if `robots.txt` doesn't exist or can't be parsed, since an absent file means no restrictions were declared). `fetchWeb.js` exports `fetchWebPage(url)` (checks `isAllowed` first; throws if disallowed; otherwise fetches and returns `{url, title, text, fetchedAt}` with HTML stripped to plain text) — consumed by Task 5's `cli.js`.
- This basic robots.txt parser handles the common `User-agent: *` / `Disallow: <path>` case — it is explicitly not a full robots.txt specification implementation (crawl-delay, wildcard patterns, and per-agent rules beyond `*` are not handled), documented as such in a code comment.

- [ ] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobotsTxt } from '../src/robots.js';

test('parseRobotsTxt disallows a path listed under User-agent: *', () => {
  const rules = parseRobotsTxt('User-agent: *\nDisallow: /private/\nDisallow: /admin\n');
  assert.equal(rules.isPathAllowed('/private/page'), false);
  assert.equal(rules.isPathAllowed('/admin'), false);
});

test('parseRobotsTxt allows paths not listed', () => {
  const rules = parseRobotsTxt('User-agent: *\nDisallow: /private/\n');
  assert.equal(rules.isPathAllowed('/public/page'), true);
});

test('parseRobotsTxt with an empty Disallow allows everything', () => {
  const rules = parseRobotsTxt('User-agent: *\nDisallow:\n');
  assert.equal(rules.isPathAllowed('/anything'), true);
});

test('parseRobotsTxt on empty content allows everything', () => {
  const rules = parseRobotsTxt('');
  assert.equal(rules.isPathAllowed('/anything'), true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/market-research && node --test test/fetchWeb.test.js`
Expected: FAIL — `robots.js` does not exist yet.

- [ ] **Step 3: Write `robots.js`**

```js
// Basic robots.txt parser -- handles the common `User-agent: *` /
// `Disallow: <path>` case only. Not a full robots.txt specification
// implementation: crawl-delay, wildcard patterns, and per-agent rules
// beyond `*` are not handled. Absence of a robots.txt, or a parse
// failure, defaults to "allowed" (no restriction was declared), not
// "disallowed" -- fail-open here matches how a real crawler treats a
// missing file, not a security boundary.

export function parseRobotsTxt(content) {
  const disallowed = [];
  let inWildcardBlock = false;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('#') || line === '') continue;

    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (key === 'user-agent') {
      inWildcardBlock = value === '*';
    } else if (key === 'disallow' && inWildcardBlock && value !== '') {
      disallowed.push(value);
    }
  }

  return {
    isPathAllowed(path) {
      return !disallowed.some((rule) => path.startsWith(rule));
    },
  };
}

export async function isAllowed(url) {
  const origin = new URL(url).origin;
  const path = new URL(url).pathname;

  try {
    const response = await fetch(`${origin}/robots.txt`);
    if (!response.ok) return true; // no robots.txt declared -- allowed
    const content = await response.text();
    return parseRobotsTxt(content).isPathAllowed(path);
  } catch {
    return true; // fetch failure -- fail-open, matches "no restriction declared"
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/market-research && node --test test/fetchWeb.test.js`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Write `fetchWeb.js`**

```js
import { isAllowed } from './robots.js';

// Strips scripts/styles then all remaining tags -- a pragmatic
// "good enough for LLM context" text extraction, not a polished
// reader-view algorithm. Documented as a known limitation, not a claim
// of production-grade content extraction.
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim() : null;
}

export async function fetchWebPage(url) {
  const allowed = await isAllowed(url);
  if (!allowed) {
    throw new Error(`Fetching ${url} is disallowed by robots.txt`);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }

  const html = await response.text();

  return {
    url,
    title: extractTitle(html),
    text: htmlToText(html),
    fetchedAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 6: Run the full test suite so far**

Run: `cd services/market-research && node --experimental-sqlite --test test/`
Expected: PASS, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add services/market-research/src/robots.js services/market-research/src/fetchWeb.js services/market-research/test/fetchWeb.test.js
git commit -m "feat(market-research): add robots.txt-respecting web-page fetcher"
```

---

### Task 3: `fetchRss.js` + `fetchGithub.js`

**Files:**
- Create: `services/market-research/src/fetchRss.js`
- Create: `services/market-research/src/fetchGithub.js`
- Test: `services/market-research/test/fetchRss.test.js`

**Interfaces:**
- Produces: `fetchRss.js` exports `parseRssItems(xml)` (pure function, returns an array of `{title, link, pubDate, description}`) and `fetchRssFeed(feedUrl)` (fetches and parses); `fetchGithub.js` exports `searchGithubRepos(query)` (calls the public GitHub search API, no auth, returns simplified `{name, fullName, description, url, stars, updatedAt}` rows) — consumed by Task 5's `cli.js`.
- The RSS parser is a lightweight regex-based extractor for the common RSS 2.0 `<item>` shape — not a full RSS/Atom-spec-compliant XML parser, documented as such.

- [ ] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRssItems } from '../src/fetchRss.js';

const SAMPLE_RSS = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example Feed</title>
    <item>
      <title>First Post</title>
      <link>https://example.com/first</link>
      <pubDate>Mon, 01 Aug 2026 00:00:00 GMT</pubDate>
      <description>First post description</description>
    </item>
    <item>
      <title>Second Post</title>
      <link>https://example.com/second</link>
      <pubDate>Tue, 02 Aug 2026 00:00:00 GMT</pubDate>
      <description>Second post description</description>
    </item>
  </channel>
</rss>`;

test('parseRssItems extracts all items with their fields', () => {
  const items = parseRssItems(SAMPLE_RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'First Post');
  assert.equal(items[0].link, 'https://example.com/first');
  assert.equal(items[1].title, 'Second Post');
});

test('parseRssItems returns an empty array for feed with no items', () => {
  const items = parseRssItems('<rss version="2.0"><channel><title>Empty</title></channel></rss>');
  assert.equal(items.length, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/market-research && node --test test/fetchRss.test.js`
Expected: FAIL — `fetchRss.js` does not exist yet.

- [ ] **Step 3: Write `fetchRss.js`**

```js
// Lightweight regex-based RSS 2.0 <item> extractor -- not a full
// RSS/Atom-spec-compliant XML parser. Handles the common
// title/link/pubDate/description shape; feeds using CDATA sections,
// namespaced elements, or the Atom format are not handled and will
// return fewer or no items rather than throwing.

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!match) return null;
  return match[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1')
    .trim();
}

export function parseRssItems(xml) {
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];

  return itemBlocks.map((block) => ({
    title: extractTag(block, 'title'),
    link: extractTag(block, 'link'),
    pubDate: extractTag(block, 'pubDate'),
    description: extractTag(block, 'description'),
  }));
}

export async function fetchRssFeed(feedUrl) {
  const response = await fetch(feedUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch RSS feed ${feedUrl}: HTTP ${response.status}`);
  }
  const xml = await response.text();
  return parseRssItems(xml);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/market-research && node --test test/fetchRss.test.js`
Expected: PASS (both tests)

- [ ] **Step 5: Write `fetchGithub.js`** (no test file — this one is a thin wrapper around a live external API; its shape is verified in Task 5's manual verification instead, matching how this plan doesn't unit-test other live-network wrappers like `fetchRssFeed`/`fetchWebPage` beyond their pure parsing logic)

```js
export async function searchGithubRepos(query) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=updated&per_page=10`;
  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json' },
  });

  if (!response.ok) {
    throw new Error(`GitHub search failed for "${query}": HTTP ${response.status}`);
  }

  const body = await response.json();

  return (body.items ?? []).map((repo) => ({
    name: repo.name,
    fullName: repo.full_name,
    description: repo.description,
    url: repo.html_url,
    stars: repo.stargazers_count,
    updatedAt: repo.updated_at,
  }));
}
```

- [ ] **Step 6: Commit**

```bash
git add services/market-research/src/fetchRss.js services/market-research/src/fetchGithub.js services/market-research/test/fetchRss.test.js
git commit -m "feat(market-research): add RSS and public GitHub search fetchers"
```

---

### Task 4: `extract.js` (pluggable, honest LLM extraction)

**Files:**
- Create: `services/market-research/src/extract.js`
- Test: `services/market-research/test/extract.test.js`

**Interfaces:**
- Produces: `extract.js` exports `extractFindings({text, source, topic, market, relatedPlatform}, { apiKey })` — if `apiKey` is falsy, returns a single `pending_extraction`-status row containing the raw text; if truthy, calls the Anthropic API and parses its response into one or more schema-shaped rows. Consumed by Task 5's `cli.js`, which passes `process.env.ANTHROPIC_API_KEY` as `apiKey`.

- [ ] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFindings } from '../src/extract.js';

test('extractFindings without an API key returns a pending_extraction row with the raw text preserved', async () => {
  const rows = await extractFindings(
    { text: 'Some raw fetched content.', source: 'https://example.com', topic: 'test topic', market: 'South Africa', relatedPlatform: null },
    { apiKey: null }
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'pending_extraction');
  assert.equal(rows[0].finding, 'Some raw fetched content.');
  assert.equal(rows[0].source, 'https://example.com');
  assert.equal(rows[0].tier, 'observation');
});

test('extractFindings without an API key never claims a fact/insight/hypothesis tier', async () => {
  const rows = await extractFindings(
    { text: 'Raw content.', source: 'https://example.com', topic: 'test', market: 'South Africa', relatedPlatform: null },
    { apiKey: null }
  );

  // A pending_extraction row is explicitly the lowest-commitment tier
  // (observation: "this text was fetched"), never a higher-confidence
  // tier that hasn't actually been earned by real extraction.
  assert.equal(rows[0].tier, 'observation');
  assert.ok(rows[0].confidence <= 0.3);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/market-research && node --test test/extract.test.js`
Expected: FAIL — `extract.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

```js
function buildPendingRow({ text, source, topic, market, relatedPlatform }) {
  const now = new Date().toISOString();
  return [{
    source,
    date: now,
    topic,
    market,
    tier: 'observation',
    finding: text,
    confidence: 0.2,
    supporting_evidence: [],
    related_dot_platform: relatedPlatform,
    recommended_action: null,
    expiry_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    fetched_at: now,
    status: 'pending_extraction',
  }];
}

const EXTRACTION_PROMPT = `You are extracting structured research findings from raw web content.
For each distinct, falsifiable finding in the text, output one JSON object with these fields:
- tier: one of "fact", "observation", "insight", "hypothesis", "recommendation"
- finding: one falsifiable statement
- confidence: 0.00-1.00, calibrated to the tier (facts from primary sources can be high; hypotheses should rarely exceed 0.5)
- supporting_evidence: array of short supporting quotes/data points from the text

Return a JSON array of these objects, nothing else. If the text contains no extractable findings, return an empty array.`;

export async function extractFindings({ text, source, topic, market, relatedPlatform }, { apiKey }) {
  if (!apiKey) {
    return buildPendingRow({ text, source, topic, market, relatedPlatform });
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 2048,
      messages: [{ role: 'user', content: `${EXTRACTION_PROMPT}\n\nText:\n${text.slice(0, 8000)}` }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API extraction failed: HTTP ${response.status}`);
  }

  const body = await response.json();
  const rawText = body.content?.[0]?.text ?? '[]';
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // The model didn't return clean JSON -- fail to a pending row rather
    // than guessing at malformed structure.
    return buildPendingRow({ text, source, topic, market, relatedPlatform });
  }

  const now = new Date().toISOString();
  return parsed.map((item) => ({
    source,
    date: now,
    topic,
    market,
    tier: item.tier,
    finding: item.finding,
    confidence: item.confidence,
    supporting_evidence: item.supporting_evidence ?? [],
    related_dot_platform: relatedPlatform,
    recommended_action: item.tier === 'recommendation' ? item.finding : null,
    expiry_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    fetched_at: now,
    status: 'structured',
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/market-research && node --test test/extract.test.js`
Expected: PASS (both tests) — these tests only exercise the no-API-key path, since a real key isn't available in this environment; the API-key path is covered by Task 5's manual verification note (see below) rather than an automated test that would need a real credential.

- [ ] **Step 5: Commit**

```bash
git add services/market-research/src/extract.js services/market-research/test/extract.test.js
git commit -m "feat(market-research): add pluggable extraction (honest pending_extraction fallback without an API key)"
```

---

### Task 5: `cli.js` + `README.md` + manual verification

**Files:**
- Create: `services/market-research/src/cli.js`
- Create: `services/market-research/README.md`

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: `node src/cli.js research "<topic>" --market="South Africa" --platform="dot-mines" [--channels=web,rss,github] [--urls=<comma-separated>] [--rss=<comma-separated>]` — the real entry point.

- [ ] **Step 1: Write `cli.js`**

```js
#!/usr/bin/env node
import { openMemory, findValid, save } from './memory.js';
import { fetchWebPage } from './fetchWeb.js';
import { fetchRssFeed } from './fetchRss.js';
import { searchGithubRepos } from './fetchGithub.js';
import { extractFindings } from './extract.js';

function parseArgs(argv) {
  const [command, topic, ...rest] = argv;
  const options = { market: 'South Africa', platform: null, urls: [], rss: [], channels: [] };

  for (const arg of rest) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'market') options.market = value;
    if (key === 'platform') options.platform = value;
    if (key === 'urls') options.urls = value.split(',');
    if (key === 'rss') options.rss = value.split(',');
    if (key === 'channels') options.channels = value.split(',');
  }

  return { command, topic, options };
}

async function main() {
  const { command, topic, options } = parseArgs(process.argv.slice(2));

  if (command !== 'research' || !topic) {
    console.error('Usage: market-research research "<topic>" --market="South Africa" [--platform=dot-mines] [--urls=url1,url2] [--rss=feed1,feed2] [--channels=github] [--github-query="..."]');
    process.exit(1);
  }

  const memory = openMemory(new URL('../data/research.sqlite', import.meta.url).pathname);

  const existing = findValid(memory, { topic, market: options.market });
  if (existing) {
    console.log(`Reusing existing finding (no new fetch needed): "${existing.finding}"`);
    console.log(`Source: ${existing.source}, expires ${existing.expiry_date}`);
    return;
  }

  console.log(`No valid existing finding for "${topic}" (${options.market}) -- researching.`);

  const apiKey = process.env.ANTHROPIC_API_KEY || null;
  if (!apiKey) {
    console.log('Note: ANTHROPIC_API_KEY not set -- findings will be stored as raw pending_extraction captures, not structured.');
  }

  let fetchedAny = false;

  for (const url of options.urls) {
    console.log(`Fetching web page: ${url}`);
    const page = await fetchWebPage(url);
    const rows = await extractFindings(
      { text: page.text, source: url, topic, market: options.market, relatedPlatform: options.platform },
      { apiKey }
    );
    rows.forEach((row) => save(memory, row));
    console.log(`  -> ${rows.length} finding(s) saved (status: ${rows[0]?.status}).`);
    fetchedAny = true;
  }

  for (const feedUrl of options.rss) {
    console.log(`Fetching RSS feed: ${feedUrl}`);
    const items = await fetchRssFeed(feedUrl);
    for (const item of items.slice(0, 5)) {
      const rows = await extractFindings(
        { text: `${item.title}\n${item.description ?? ''}`, source: item.link ?? feedUrl, topic, market: options.market, relatedPlatform: options.platform },
        { apiKey }
      );
      rows.forEach((row) => save(memory, row));
    }
    console.log(`  -> processed ${Math.min(items.length, 5)} item(s).`);
    fetchedAny = true;
  }

  if (options.channels.includes('github')) {
    console.log(`Searching public GitHub for: ${topic}`);
    const repos = await searchGithubRepos(topic);
    for (const repo of repos.slice(0, 5)) {
      const rows = await extractFindings(
        { text: `${repo.fullName}: ${repo.description ?? ''} (${repo.stars} stars, updated ${repo.updatedAt})`, source: repo.url, topic, market: options.market, relatedPlatform: options.platform },
        { apiKey }
      );
      rows.forEach((row) => save(memory, row));
    }
    console.log(`  -> processed ${Math.min(repos.length, 5)} repo(s).`);
    fetchedAny = true;
  }

  if (!fetchedAny) {
    console.log('No channels specified -- pass --urls, --rss, and/or --channels=github to actually research something.');
  }
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
```

- [ ] **Step 2: Write `README.md`**

```markdown
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
```

- [ ] **Step 3: Run the full test suite**

Run: `cd services/market-research && node --experimental-sqlite --test test/`
Expected: PASS, 0 failures.

- [ ] **Step 4: Manual end-to-end verification**

1. `cd services/market-research`
2. Run against a real, real-world public URL and a real GitHub search query, without `ANTHROPIC_API_KEY` set:
   ```bash
   node src/cli.js research "static site generators" --market="Global" --urls="https://jamstack.org" --channels=github
   ```
   Confirm it prints fetch progress, saves rows with `status: pending_extraction` (since no key is set), and doesn't crash.
3. Re-run the exact same command. Confirm it now prints "Reusing existing finding" instead of re-fetching (dedup-before-research working).
4. Query the SQLite file directly to confirm real rows exist:
   ```bash
   node --experimental-sqlite -e "
   const { DatabaseSync } = require('node:sqlite');
   const db = new DatabaseSync('data/research.sqlite');
   console.log(db.prepare('SELECT topic, source, status, tier FROM findings').all());
   "
   ```
5. **Note on the API-key path**: if you have a real `ANTHROPIC_API_KEY` available and want to verify structured extraction end-to-end, export it and re-run step 2 against a fresh topic — confirm rows save with `status: structured` and real `tier`/`confidence` values. This step is optional and wasn't run automatically in this session since no key was available in this environment — report honestly whether it was exercised, don't claim it was tested if it wasn't.
6. Confirm `data/research.sqlite` is not staged by `git status` (gitignore working).

- [ ] **Step 5: Commit**

```bash
git add services/market-research/src/cli.js services/market-research/README.md
git commit -m "feat(market-research): add CLI entry point and README, completing the pilot"
```
