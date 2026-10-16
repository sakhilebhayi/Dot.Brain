# Cross-Platform Read Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the generic, enrollable `dot-revenue/v1` capability — contract, a new Brain-owned `services/revenue-reader` service, manifest-based enrollment, and the governance ADR that carves this explicit exception into Dot.Brain's ingest-only boundary — per `docs/superpowers/specs/2026-09-23-cross-platform-read-access-design.md`.

**Architecture:** A new standalone service, `services/revenue-reader/`, following the exact conventions already used by `services/guardian` and `services/insight-delivery` (ES modules, `node --test`, injectable `fetch`/env, a CLI `bin`). It provides: (1) a manifest registry that loads and validates per-platform enrollment files, (2) defensive contract validation for the `dot-revenue/v1` response shape, and (3) a poll client that fails closed on a missing token, classifies every failure mode, and never persists a raw payload — the caller (a future Revenue Intelligence module) decides what to do with a successful result. Four doc updates record the new component and the governance decision.

**Tech Stack:** Node.js ≥ 22.5 (ESM), built-in `node:test` + `node:assert/strict` (matches every sibling service), no external dependencies.

## Global Constraints

- `classification` on every response is required and must be one of `public|ecosystem|restricted|sensitive` (design spec §1) — a response missing or misusing it is rejected as a contract failure, never partially trusted.
- A response whose `classification` exceeds the enrolling platform's own manifest `classification_ceiling` is rejected outright (design spec §4) — this is a distinct rejection mode from a plain contract failure.
- No raw pulled payload is ever persisted by this service — it returns a poll result to its caller and holds nothing itself (design spec §4). This plan does not build a Revenue Intelligence consumer; that is a separate, later sub-project.
- No platform's actual `dot-revenue/v1` endpoint is built in this plan (design spec Non-goals) — all tests exercise the client against an injectable `fetch`, never a real network call.
- Token handling fails closed: a missing `token_env` value means no network request is attempted at all (design spec §3, mirrors Guardian's precedent).
- No changes to `services/guardian`, `services/insight-delivery`, DKP publishing, the PR Generator, or Insight Delivery's existing files.

---

## File Structure

```
services/revenue-reader/
  package.json
  README.md
  src/
    registry.js    # loadManifests, validateManifest, REQUIRED_KEYS, DEFAULTS
    contract.js     # validateSignalsResponse, classificationExceedsCeiling, CLASSIFICATIONS
    client.js       # tokenFor, pollPlatform
    cli.js          # bin entry point wiring the above
  test/
    registry.test.js
    contract.test.js
    client.test.js

adr/ADR-0018-cross-platform-read-access.md   # new
brain.architecture.md                          # modified: new component, new trust-boundary line
brain.security.md                              # modified: new capability joins the audited list
.github/workflows/tests.yml                    # modified: add revenue-reader to the CI matrix + coverage check
```

---

### Task 1: Manifest registry

**Files:**
- Create: `services/revenue-reader/src/registry.js`
- Test: `services/revenue-reader/test/registry.test.js`

**Interfaces:**
- Produces:
  - `REQUIRED_KEYS: string[]`
  - `DEFAULTS: {poll_interval_s: number, timeout_ms: number, classification_ceiling: string}`
  - `validateManifest(raw: object) => object` — throws `Error` listing every missing required key; otherwise returns `{...DEFAULTS, ...raw}`
  - `loadManifests(dir: string, readDirImpl?: Function, readFileImpl?: Function) => object[]` — throws `Error` prefixed with the offending filename on an invalid manifest

- [ ] **Step 1: Write the failing tests**

```js
// services/revenue-reader/test/registry.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, loadManifests, DEFAULTS, REQUIRED_KEYS } from '../src/registry.js';

test('REQUIRED_KEYS lists platform, signals_url, and token_env', () => {
  assert.deepEqual(REQUIRED_KEYS, ['platform', 'signals_url', 'token_env']);
});

test('validateManifest fills in defaults for optional keys', () => {
  const result = validateManifest({
    platform: 'dot-billing',
    signals_url: 'https://billing.dot/revenue/signals',
    token_env: 'DOT_BILLING_REVENUE_TOKEN',
  });
  assert.equal(result.poll_interval_s, 3600);
  assert.equal(result.timeout_ms, 15000);
  assert.equal(result.classification_ceiling, 'restricted');
});

test('validateManifest preserves explicit overrides of defaults', () => {
  const result = validateManifest({
    platform: 'dot-billing',
    signals_url: 'https://billing.dot/revenue/signals',
    token_env: 'DOT_BILLING_REVENUE_TOKEN',
    poll_interval_s: 900,
  });
  assert.equal(result.poll_interval_s, 900);
});

test('validateManifest throws listing every missing required key', () => {
  assert.throws(
    () => validateManifest({ platform: 'dot-billing' }),
    /signals_url, token_env/,
  );
});

test('validateManifest throws when given an empty object', () => {
  assert.throws(
    () => validateManifest({}),
    /platform, signals_url, token_env/,
  );
});

test('loadManifests parses and validates every .json file in a directory', () => {
  const readDirImpl = () => ['dot-billing.json', 'dot-analytics.json', 'notes.txt'];
  const files = {
    'dir/dot-billing.json': JSON.stringify({
      platform: 'dot-billing',
      signals_url: 'https://billing.dot/revenue/signals',
      token_env: 'DOT_BILLING_REVENUE_TOKEN',
    }),
    'dir/dot-analytics.json': JSON.stringify({
      platform: 'dot-analytics',
      signals_url: 'https://analytics.dot/revenue/signals',
      token_env: 'DOT_ANALYTICS_REVENUE_TOKEN',
    }),
  };
  const readFileImpl = (path) => files[path];
  const manifests = loadManifests('dir', readDirImpl, readFileImpl);
  assert.equal(manifests.length, 2);
  assert.equal(manifests[0].platform, 'dot-billing');
  assert.equal(manifests[1].platform, 'dot-analytics');
});

test('loadManifests ignores non-.json files in the directory', () => {
  const readDirImpl = () => ['dot-billing.json', 'README.md'];
  const files = {
    'dir/dot-billing.json': JSON.stringify({
      platform: 'dot-billing',
      signals_url: 'https://billing.dot/revenue/signals',
      token_env: 'DOT_BILLING_REVENUE_TOKEN',
    }),
  };
  const readFileImpl = (path) => files[path];
  const manifests = loadManifests('dir', readDirImpl, readFileImpl);
  assert.equal(manifests.length, 1);
});

test('loadManifests includes the filename when a manifest is invalid', () => {
  const readDirImpl = () => ['broken.json'];
  const readFileImpl = () => JSON.stringify({ platform: 'dot-broken' });
  assert.throws(
    () => loadManifests('dir', readDirImpl, readFileImpl),
    /broken\.json/,
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/revenue-reader && node --test test/registry.test.js`
Expected: FAIL — `Cannot find module '../src/registry.js'`

- [ ] **Step 3: Write the minimal implementation**

```js
// services/revenue-reader/src/registry.js
import { readdirSync, readFileSync } from 'node:fs';

/**
 * Enrolling a platform is one manifest file (design spec §2) -- this is
 * the only place that decides whether it's well-formed.
 */
export const REQUIRED_KEYS = ['platform', 'signals_url', 'token_env'];

export const DEFAULTS = {
  poll_interval_s: 3600,
  timeout_ms: 15000,
  classification_ceiling: 'restricted',
};

/**
 * @param {object} raw
 * @returns {object} the manifest with every DEFAULTS key filled in
 */
export function validateManifest(raw) {
  const missing = REQUIRED_KEYS.filter((key) => !raw?.[key]);
  if (missing.length > 0) {
    throw new Error(`manifest missing required key(s): ${missing.join(', ')}`);
  }
  return { ...DEFAULTS, ...raw };
}

/**
 * Loads and validates every manifest in a directory. One bad manifest
 * fails loudly with its filename rather than being silently skipped.
 *
 * @param {string} dir
 * @param {typeof readdirSync} [readDirImpl]
 * @param {typeof readFileSync} [readFileImpl]
 * @returns {object[]}
 */
export function loadManifests(dir, readDirImpl = readdirSync, readFileImpl = readFileSync) {
  return readDirImpl(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const raw = JSON.parse(readFileImpl(`${dir}/${name}`, 'utf8'));
      try {
        return validateManifest(raw);
      } catch (error) {
        throw new Error(`${name}: ${error.message}`);
      }
    });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd services/revenue-reader && node --test test/registry.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add services/revenue-reader/src/registry.js services/revenue-reader/test/registry.test.js
git commit -m "feat(revenue-reader): add manifest registry"
```

---

### Task 2: Contract validation

**Files:**
- Create: `services/revenue-reader/src/contract.js`
- Test: `services/revenue-reader/test/contract.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `CLASSIFICATIONS: string[]` — `['public', 'ecosystem', 'restricted', 'sensitive']`, ordered least to most restrictive
  - `validateSignalsResponse(body: object) => {valid: boolean, reason?: string}`
  - `classificationExceedsCeiling(classification: string, ceiling: string) => boolean`

- [ ] **Step 1: Write the failing tests**

```js
// services/revenue-reader/test/contract.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSignalsResponse, classificationExceedsCeiling, CLASSIFICATIONS } from '../src/contract.js';

const VALID_BODY = {
  platform: 'dot-billing',
  contract: 'dot-revenue/v1',
  generated_at: '2026-09-23T10:00:00Z',
  classification: 'restricted',
  signals: [{ key: 'revenue.mrr', value: 48210.55, unit: 'usd' }],
};

test('CLASSIFICATIONS is ordered least to most restrictive', () => {
  assert.deepEqual(CLASSIFICATIONS, ['public', 'ecosystem', 'restricted', 'sensitive']);
});

test('validateSignalsResponse accepts a well-formed body', () => {
  assert.deepEqual(validateSignalsResponse(VALID_BODY), { valid: true });
});

test('validateSignalsResponse rejects a non-object body', () => {
  const result = validateSignalsResponse(null);
  assert.equal(result.valid, false);
  assert.match(result.reason, /not an object/);
});

test('validateSignalsResponse rejects a missing classification', () => {
  const { classification, ...withoutClassification } = VALID_BODY;
  const result = validateSignalsResponse(withoutClassification);
  assert.equal(result.valid, false);
  assert.match(result.reason, /classification must be one of/);
});

test('validateSignalsResponse rejects an unknown classification value', () => {
  const result = validateSignalsResponse({ ...VALID_BODY, classification: 'top-secret' });
  assert.equal(result.valid, false);
  assert.match(result.reason, /classification must be one of/);
});

test('validateSignalsResponse rejects a non-array signals field', () => {
  const result = validateSignalsResponse({ ...VALID_BODY, signals: 'not-an-array' });
  assert.equal(result.valid, false);
  assert.match(result.reason, /signals must be an array/);
});

test('validateSignalsResponse rejects a signal missing key or value', () => {
  const result = validateSignalsResponse({ ...VALID_BODY, signals: [{ unit: 'usd' }] });
  assert.equal(result.valid, false);
  assert.match(result.reason, /signals\[0\]/);
});

test('validateSignalsResponse accepts multiple well-formed signals', () => {
  const result = validateSignalsResponse({
    ...VALID_BODY,
    signals: [
      { key: 'revenue.mrr', value: 48210.55 },
      { key: 'revenue.churn_rate', value: 0.021 },
    ],
  });
  assert.deepEqual(result, { valid: true });
});

test('classificationExceedsCeiling is false when classification is at or below the ceiling', () => {
  assert.equal(classificationExceedsCeiling('ecosystem', 'restricted'), false);
  assert.equal(classificationExceedsCeiling('restricted', 'restricted'), false);
  assert.equal(classificationExceedsCeiling('public', 'restricted'), false);
});

test('classificationExceedsCeiling is true when classification exceeds the ceiling', () => {
  assert.equal(classificationExceedsCeiling('sensitive', 'restricted'), true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/revenue-reader && node --test test/contract.test.js`
Expected: FAIL — `Cannot find module '../src/contract.js'`

- [ ] **Step 3: Write the minimal implementation**

```js
// services/revenue-reader/src/contract.js

/**
 * Defensive contract validation for a dot-revenue/v1 response body
 * (design spec §1) -- a response is rejected as a contract failure,
 * never partially trusted, mirroring Guardian's health.js precedent.
 */
export const CLASSIFICATIONS = ['public', 'ecosystem', 'restricted', 'sensitive'];

/**
 * @param {object} body
 * @returns {{valid: boolean, reason?: string}}
 */
export function validateSignalsResponse(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, reason: 'response body is not an object' };
  }
  if (!CLASSIFICATIONS.includes(body.classification)) {
    return {
      valid: false,
      reason: `classification must be one of ${CLASSIFICATIONS.join(', ')}, got ${JSON.stringify(body.classification)}`,
    };
  }
  if (!Array.isArray(body.signals)) {
    return { valid: false, reason: 'signals must be an array' };
  }
  for (const [index, signal] of body.signals.entries()) {
    if (!signal || typeof signal !== 'object' || !signal.key || signal.value === undefined) {
      return { valid: false, reason: `signals[${index}] is missing key or value` };
    }
  }
  return { valid: true };
}

/**
 * True when a response's declared classification exceeds the enrolling
 * platform's own classification_ceiling (design spec §4) -- rejected
 * outright and raised as an incident, the one rejection mode Guardian's
 * contract didn't need.
 *
 * @param {string} classification
 * @param {string} ceiling
 * @returns {boolean}
 */
export function classificationExceedsCeiling(classification, ceiling) {
  return CLASSIFICATIONS.indexOf(classification) > CLASSIFICATIONS.indexOf(ceiling);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd services/revenue-reader && node --test test/contract.test.js`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add services/revenue-reader/src/contract.js services/revenue-reader/test/contract.test.js
git commit -m "feat(revenue-reader): add dot-revenue/v1 contract validation"
```

---

### Task 3: Poll client

**Files:**
- Create: `services/revenue-reader/src/client.js`
- Test: `services/revenue-reader/test/client.test.js`

**Interfaces:**
- Consumes: `validateSignalsResponse`, `classificationExceedsCeiling` from Task 2 (`contract.js`).
- Produces:
  - `tokenFor(manifest: object, env?: object) => string|null`
  - `pollPlatform(manifest: object, opts?: {fetchImpl?: typeof fetch, env?: object}) => Promise<{ok: true, platform: string, generated_at: string, classification: string, signals: object[]} | {ok: false, platform: string, kind: 'auth'|'network'|'contract'|'classification_ceiling', reason: string}>`

A stateful, multi-poll availability tracker (mirroring Guardian's `detect.js`/`store.js`, which decide when *repeated* failures become an incident) is explicitly out of scope here — this plan ships the per-poll failure classification that such a tracker would consume later, once a real platform is enrolled and there is an actual polling history to track (design spec Non-goals: no platform's endpoint exists yet to poll repeatedly).

- [ ] **Step 1: Write the failing tests**

```js
// services/revenue-reader/test/client.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenFor, pollPlatform } from '../src/client.js';

const MANIFEST = {
  platform: 'dot-billing',
  signals_url: 'https://billing.dot/revenue/signals',
  token_env: 'DOT_BILLING_REVENUE_TOKEN',
  poll_interval_s: 3600,
  timeout_ms: 15000,
  classification_ceiling: 'restricted',
};

const VALID_BODY = {
  platform: 'dot-billing',
  contract: 'dot-revenue/v1',
  generated_at: '2026-09-23T10:00:00Z',
  classification: 'restricted',
  signals: [{ key: 'revenue.mrr', value: 48210.55, unit: 'usd' }],
};

test('tokenFor reads the manifest-declared env var', () => {
  assert.equal(tokenFor(MANIFEST, { DOT_BILLING_REVENUE_TOKEN: 'tok-123' }), 'tok-123');
});

test('tokenFor returns null when the env var is unset', () => {
  assert.equal(tokenFor(MANIFEST, {}), null);
});

test('pollPlatform fails closed with kind auth when the token is missing, before any fetch', async () => {
  let fetchCalled = false;
  const fetchImpl = async () => { fetchCalled = true; };
  const result = await pollPlatform(MANIFEST, { fetchImpl, env: {} });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'auth');
  assert.match(result.reason, /DOT_BILLING_REVENUE_TOKEN/);
  assert.equal(fetchCalled, false);
});

test('pollPlatform sends the bearer token and returns signals on success', async () => {
  let receivedUrl;
  let receivedHeaders;
  const fetchImpl = async (url, options) => {
    receivedUrl = url;
    receivedHeaders = options.headers;
    return { ok: true, json: async () => VALID_BODY };
  };
  const result = await pollPlatform(MANIFEST, { fetchImpl, env: { DOT_BILLING_REVENUE_TOKEN: 'tok-123' } });
  assert.equal(result.ok, true);
  assert.equal(result.platform, 'dot-billing');
  assert.equal(result.classification, 'restricted');
  assert.deepEqual(result.signals, VALID_BODY.signals);
  assert.equal(receivedUrl, MANIFEST.signals_url);
  assert.equal(receivedHeaders.Authorization, 'Bearer tok-123');
});

test('pollPlatform reports kind network on a non-ok HTTP status', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503 });
  const result = await pollPlatform(MANIFEST, { fetchImpl, env: { DOT_BILLING_REVENUE_TOKEN: 'tok-123' } });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'network');
  assert.match(result.reason, /503/);
});

test('pollPlatform reports kind network when fetch itself throws', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  const result = await pollPlatform(MANIFEST, { fetchImpl, env: { DOT_BILLING_REVENUE_TOKEN: 'tok-123' } });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'network');
  assert.match(result.reason, /ECONNREFUSED/);
});

test('pollPlatform reports kind contract on a malformed body', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ ...VALID_BODY, signals: 'nope' }) });
  const result = await pollPlatform(MANIFEST, { fetchImpl, env: { DOT_BILLING_REVENUE_TOKEN: 'tok-123' } });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'contract');
  assert.match(result.reason, /signals must be an array/);
});

test('pollPlatform reports kind classification_ceiling when the response exceeds the manifest ceiling', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ ...VALID_BODY, classification: 'sensitive' }) });
  const result = await pollPlatform(MANIFEST, { fetchImpl, env: { DOT_BILLING_REVENUE_TOKEN: 'tok-123' } });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'classification_ceiling');
  assert.match(result.reason, /exceeds this platform's ceiling/);
});

test('pollPlatform never returns the raw response body, only the extracted fields', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ ...VALID_BODY, extra_internal_field: 'should not leak' }) });
  const result = await pollPlatform(MANIFEST, { fetchImpl, env: { DOT_BILLING_REVENUE_TOKEN: 'tok-123' } });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result).sort(), ['classification', 'generated_at', 'ok', 'platform', 'signals']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/revenue-reader && node --test test/client.test.js`
Expected: FAIL — `Cannot find module '../src/client.js'`

- [ ] **Step 3: Write the minimal implementation**

```js
// services/revenue-reader/src/client.js
import { validateSignalsResponse, classificationExceedsCeiling } from './contract.js';

/**
 * @param {object} manifest a validated manifest (registry.js)
 * @param {object} [env] process.env, injectable for tests
 * @returns {string|null}
 */
export function tokenFor(manifest, env = process.env) {
  return env[manifest.token_env] || null;
}

/**
 * One poll attempt against a platform's dot-revenue/v1 endpoint
 * (design spec §1, §4). Fails closed on a missing token before any
 * network call, mirroring Guardian's precedent. Never persists
 * anything and never returns more than the four extracted fields --
 * the caller decides what, if anything, to do with a successful result.
 *
 * @param {object} manifest a validated manifest (registry.js)
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {object} [opts.env]
 */
export async function pollPlatform(manifest, { fetchImpl = fetch, env = process.env } = {}) {
  const token = tokenFor(manifest, env);
  if (!token) {
    return { ok: false, platform: manifest.platform, kind: 'auth', reason: `${manifest.token_env} is not set` };
  }

  let response;
  try {
    response = await fetchImpl(manifest.signals_url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(manifest.timeout_ms),
    });
  } catch (error) {
    return { ok: false, platform: manifest.platform, kind: 'network', reason: error.message };
  }

  if (!response.ok) {
    return { ok: false, platform: manifest.platform, kind: 'network', reason: `HTTP ${response.status}` };
  }

  const body = await response.json();
  const validation = validateSignalsResponse(body);
  if (!validation.valid) {
    return { ok: false, platform: manifest.platform, kind: 'contract', reason: validation.reason };
  }

  if (classificationExceedsCeiling(body.classification, manifest.classification_ceiling)) {
    return {
      ok: false,
      platform: manifest.platform,
      kind: 'classification_ceiling',
      reason: `response classification "${body.classification}" exceeds this platform's ceiling "${manifest.classification_ceiling}"`,
    };
  }

  return {
    ok: true,
    platform: manifest.platform,
    generated_at: body.generated_at,
    classification: body.classification,
    signals: body.signals,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd services/revenue-reader && node --test test/client.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add services/revenue-reader/src/client.js services/revenue-reader/test/client.test.js
git commit -m "feat(revenue-reader): add poll client"
```

---

### Task 4: CLI, package.json, README, CI registration

**Files:**
- Create: `services/revenue-reader/package.json`
- Create: `services/revenue-reader/src/cli.js`
- Create: `services/revenue-reader/README.md`
- Modify: `.github/workflows/tests.yml`

**Interfaces:**
- Consumes: `loadManifests` (Task 1), `pollPlatform` (Task 3).
- Produces: a `bin` entry point, `revenue-reader`, with one subcommand `poll` — no new exported functions consumed by later tasks.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@dot-brain/revenue-reader",
  "version": "1.0.0",
  "description": "Brain-initiated pull reader for the dot-revenue/v1 contract -- polls enrolled platforms' pre-aggregated business signals under a scoped bearer token, validates defensively, and never persists a raw payload. See ../../docs/superpowers/specs/2026-09-23-cross-platform-read-access-design.md.",
  "type": "module",
  "bin": { "revenue-reader": "./src/cli.js" },
  "scripts": { "test": "node --test" },
  "engines": { "node": ">=22.5.0" }
}
```

- [ ] **Step 2: Write `src/cli.js`**

```js
#!/usr/bin/env node
// Usage: revenue-reader poll --manifest-dir platforms/revenue-reader [--platform dot-billing]
import { loadManifests } from './registry.js';
import { pollPlatform } from './client.js';

const [, , cmd, ...rest] = process.argv;

function flag(name, fallback) {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? fallback : rest[i + 1];
}

if (cmd === 'poll') {
  const dir = flag('manifest-dir');
  const onlyPlatform = flag('platform');
  if (!dir) {
    console.error('usage: revenue-reader poll --manifest-dir <dir> [--platform <id>]');
    process.exit(1);
  }

  const manifests = loadManifests(dir).filter((m) => !onlyPlatform || m.platform === onlyPlatform);
  let exitCode = 0;

  for (const manifest of manifests) {
    const result = await pollPlatform(manifest);
    if (result.ok) {
      console.log(`${result.platform}: ${result.signals.length} signal(s), classification=${result.classification}`);
    } else {
      console.error(`${result.platform}: ${result.kind} -- ${result.reason}`);
      exitCode = 1;
    }
  }

  process.exit(exitCode);
} else {
  console.error('usage: revenue-reader poll --manifest-dir <dir> [--platform <id>]');
  process.exit(1);
}
```

- [ ] **Step 3: Write `README.md`**

```markdown
# Dot.Brain — Revenue Reader

Brain-initiated pull reader for the `dot-revenue/v1` contract (design spec:
[docs/superpowers/specs/2026-09-23-cross-platform-read-access-design.md](../../docs/superpowers/specs/2026-09-23-cross-platform-read-access-design.md),
ADR: [ADR-0018](../../adr/ADR-0018-cross-platform-read-access.md)).

Mirrors Dot Guardian's contract shape (`services/guardian`, ADR-0014):
manifest-based enrollment, a scoped bearer token per platform, and
defensive validation that never trusts a response body blindly. Unlike
Guardian, this reads pre-aggregated business signals rather than health
checks, so every response also declares a `classification`
(`public|ecosystem|restricted|sensitive`) that must not exceed the
enrolling platform's own manifest-declared ceiling.

## No platform is enrolled yet

This ships the generic capability only. A platform enrolls by adding a
manifest to `platforms/revenue-reader/<platform>.json` and exposing a
`GET /revenue/signals` endpoint — that endpoint is separate, coordinated
work in the platform's own repository (design spec Non-goals).

## Manifest shape

```json
{
  "platform": "dot-billing",
  "signals_url": "https://billing.dot/revenue/signals",
  "token_env": "DOT_BILLING_REVENUE_TOKEN",
  "poll_interval_s": 3600,
  "timeout_ms": 15000,
  "classification_ceiling": "restricted"
}
```

Only `platform`, `signals_url`, and `token_env` are required; the rest
default per `src/registry.js`'s `DEFAULTS`.

## Pipeline

1. `loadManifests()` — reads and validates every manifest in a directory.
2. `pollPlatform()` — one poll attempt: fails closed with `kind: 'auth'`
   if the token env var is unset (no network call is made), reports
   `kind: 'network'` on a fetch failure or non-2xx status, `kind:
   'contract'` on a malformed response body, or `kind:
   'classification_ceiling'` if the response is more sensitive than the
   platform's manifest allows. A successful poll returns exactly
   `{ok, platform, generated_at, classification, signals}` — nothing
   else, and nothing is persisted.

A stateful, multi-poll availability tracker (mirroring Guardian's
`detect.js`/`store.js`) is intentionally not built here — see the design
spec's Non-goals and Task 3's note in the implementation plan.

## Usage

```bash
revenue-reader poll --manifest-dir platforms/revenue-reader
```

## Tests

```bash
npm test
```
```

- [ ] **Step 4: Register the service in CI**

Read `.github/workflows/tests.yml` first to confirm the exact current matrix and `covered` list (they were last touched by the Insight Delivery work — `insight-delivery` should already be present). Add `revenue-reader` to both:

```yaml
      matrix:
        service:
          - guardian
          - intelligence
          - autonomy-score
          - market-research
          - intervention-log
          - guardian-trigger
          - blupin-context
          - insight-delivery
          - revenue-reader
```

And to the `covered="..."` string in the `coverage-of-suites` job:

```bash
covered="guardian intelligence autonomy-score market-research intervention-log guardian-trigger blupin-context insight-delivery revenue-reader"
```

- [ ] **Step 5: Run the full test suite to confirm nothing broke**

Run: `cd services/revenue-reader && npm test`
Expected: PASS (all 27 tests across the three test files: 8 registry + 10 contract + 9 client)

- [ ] **Step 6: Commit**

```bash
git add services/revenue-reader/package.json services/revenue-reader/src/cli.js services/revenue-reader/README.md .github/workflows/tests.yml
git commit -m "feat(revenue-reader): add CLI, package manifest, README, and CI registration"
```

---

### Task 5: `ADR-0018`

**Files:**
- Create: `adr/ADR-0018-cross-platform-read-access.md`

- [ ] **Step 1: Write the ADR**, following the exact section structure of `adr/ADR-0014-dot-guardian-architecture.md` and `adr/ADR-0017-outbound-insight-delivery.md` (Status / Context / Decision / Consequences / Alternatives considered / Change log / Open questions):

```markdown
---
title: ADR-0018 — Cross-Platform Read Access via the dot-revenue/v1 Contract
version: 1.0.0
status: active
owners: [Chief Architect]
last-review: 2026-09-23
---

# ADR-0018 — Cross-Platform Read Access via the dot-revenue/v1 Contract

Purpose: record the decision to give Dot.Brain its first Brain-initiated pull path — a scoped, manifest-enrolled capability for reading pre-aggregated business signals from platforms — and the explicit, narrow exception this carves into the ingest-only trust boundary.

> **Related documents:** [docs/superpowers/specs/2026-09-23-cross-platform-read-access-design.md](../docs/superpowers/specs/2026-09-23-cross-platform-read-access-design.md) — the full design · [ADR-0014-dot-guardian-architecture.md](ADR-0014-dot-guardian-architecture.md) — the contract shape this reuses · [ADR-0017-outbound-insight-delivery.md](ADR-0017-outbound-insight-delivery.md) — the reasoning pipeline this feeds · [../brain.architecture.md](../brain.architecture.md) · [../brain.security.md](../brain.security.md) · [../services/revenue-reader](../services/revenue-reader/README.md) — reference implementation.

---

## Status

Accepted — 2026-09-23

## Context

No platform publishes revenue-relevant Knowledge Packs today, and Dot.Billing — the platform that owns settlement data — exposes nothing live at all: settlement data currently leaves only via batched DKP packs (`dot-billing.md:42-49`), with no on-demand read surface. Waiting for every platform to redesign its DKP publishing schedule and schema around revenue-shaped signals is slower and less controllable than Brain being able to ask directly.

That is a real boundary change. `CLAUDE.md` Rule 4 states Brain "ingests published Knowledge Packs and responds with Pull Requests" — a live-pull channel is a third mode that sentence does not describe, and today's trust-boundary docs describe zero Brain→platform pull path in either direction (`brain.architecture.md:133`, `brain.security.md:30-47`).

Dot Guardian (`ADR-0014`) is the one existing production precedent for a Dot.Brain-owned service reading live data from a platform, and its contract shape already satisfies Brain's security bar: manifest-based enrollment needing no architecture change per platform, a scoped bearer token per platform that fails closed when unset, and defensive contract validation that never trusts a response body blindly.

## Decision

1. **A new, narrow pull path, not a reinterpretation of the ingest boundary.** DKP publishing is unchanged; this adds a second, independent inbound mechanism scoped exactly to pre-aggregated business signals.
2. **Reuse Guardian's contract shape.** Manifest-based enrollment (`platforms/revenue-reader/<platform>.json`), a scoped bearer token per platform (`token_env`, fails closed), defensive validation that rejects rather than partially trusts a malformed response.
3. **Platforms expose signals, never raw records.** A platform's own code decides what a signal aggregates over; Brain never receives transaction- or PII-level data, satisfying the cross-tenant confidentiality rule (`brain.governance.md:101`).
4. **Nothing raw is persisted.** A poll result lives only for the span of one reasoning pass; only a derived Insight or Recommendation is written to the graph, with an `evidence` entry of kind `external` pointing back to the read, never the payload itself.
5. **Classification is enforced twice.** Every response declares its own `classification`; a manifest also declares a `classification_ceiling`, and a response exceeding it is rejected outright as an incident — a rejection mode Guardian's operational-signal-only contract never needed.
6. **A distinct token namespace from Guardian's.** Same token shape, but named so a revenue-signal token can never be confused with or substituted for a Guardian health-check token, given the higher stakes of financial data.

## Consequences

- Dot.Brain gains a second inbound mechanism alongside DKP publishing — `brain.architecture.md` and `brain.security.md` are updated to describe it as an explicit, bounded exception, not a general capability.
- A future Revenue Intelligence module can consume `services/revenue-reader`'s poll results as a new input to the existing W3 reasoning → W4 gates → Insight/Recommendation pipeline, unchanged.
- No platform is obligated to enroll; a platform that never adds a manifest is entirely unaffected.
- Building any platform's actual `dot-revenue/v1` endpoint (starting with Dot.Billing) is separate, coordinated work outside this repository.

## Alternatives considered

- **Extend DKP publishing cadence/schema instead.** Rejected: does not give Brain control over *when* it asks, and depends on every platform independently redesigning its own publishing schedule.
- **Wait for platforms to adopt revenue-shaped DKP packs organically.** Rejected as too slow and uncontrollable, given the explicit choice for live access over the ingest-only model for this specific capability.
- **A structurally new token/credential system for this capability.** Rejected: `brain.security.md:70,74` establishes one key system ecosystem-wide with no shared secrets between platforms; a second key system would violate that directly. Same token shape as Guardian's, under a distinct naming convention, satisfies the stated need for separation without duplicating the key system.

---

## Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-09-23 | Brainstorming/planning session | Initial decision record. |

## Open questions

- Exact default `poll_interval_s` and per-signal staleness semantics (a `valid_until` per signal) — `3600` is a starting default, to be revisited once a real platform enrolls.
- Whether `classification_ceiling` should also be asserted platform-side as a hard manifest requirement, in addition to Brain-side enforcement, for defense in depth.
```

- [ ] **Step 2: Verify the ADR is reachable**

Run: `grep -n "ADR-0018" brain.architecture.md brain.security.md services/revenue-reader/README.md`
Expected: at least one match per file (confirms Tasks 4, 6, 7 already link to it — if any is missing, add the link now).

- [ ] **Step 3: Commit**

```bash
git add adr/ADR-0018-cross-platform-read-access.md
git commit -m "docs(adr): add ADR-0018, cross-platform read access via the dot-revenue/v1 contract"
```

---

### Task 6: `brain.architecture.md` — new component and trust boundary

**Files:**
- Modify: `brain.architecture.md`

- [ ] **Step 1: Read the file first** to locate its exact current §2 (Layer model) Mermaid diagram, §3 (Component responsibilities) table, and §6 (Security & trust boundaries) inbound-boundary bullet — these were already touched once this session (Insight Delivery's outbound-path addition) so confirm current line numbers before editing rather than assuming the numbers cited in the design spec's research are still exact.

- [ ] **Step 2: Add a new component to the §2 diagram**

In the Platform Edge / L1 Ingestion subgraph (wherever DKP Publishers is drawn), add a sibling node for the new inbound mechanism, e.g.:

```
REVREAD[Revenue Reader<br/>Brain-initiated pull, dot-revenue/v1]
```

with an edge showing it feeds the same L3 Intelligence layer as DKP-ingested data does (do not wire it into the Knowledge Graph directly — it is explicitly NOT persisted raw, per ADR-0018 decision 4).

- [ ] **Step 3: Add the component table row**

In §3's component table, add:

```markdown
| Revenue Reader | Poll enrolled platforms' dot-revenue/v1 endpoints under a scoped token; validate defensively; classify every failure; never persist a raw payload | [ADR-0018](adr/ADR-0018-cross-platform-read-access.md), [docs/superpowers/specs/2026-09-23-cross-platform-read-access-design.md](docs/superpowers/specs/2026-09-23-cross-platform-read-access-design.md) | Architecture, reference implementation `services/revenue-reader` |
```

- [ ] **Step 4: Update the §6 inbound trust-boundary bullet**

Find the bullet describing the inbound boundary (research cites it as "only signed DKPs through the Gateway; no direct graph writes from outside"). Add a second sentence naming the new, narrow exception:

```markdown
A second, narrow inbound mechanism exists for pre-aggregated business signals only (never raw records, never persisted): the Revenue Reader's manifest-enrolled, scoped-token pull against a platform's dot-revenue/v1 endpoint. See [ADR-0018](adr/ADR-0018-cross-platform-read-access.md) for the explicit exception this carves and its limits.
```

- [ ] **Step 5: Verify**

Run: `grep -n "Revenue Reader\|ADR-0018" brain.architecture.md`
Expected: at least 3 matches (diagram node, table row, trust-boundary sentence).

- [ ] **Step 6: Commit**

```bash
git add brain.architecture.md
git commit -m "docs(brain.architecture): document the Revenue Reader component and its inbound trust-boundary exception"
```

---

### Task 7: `brain.security.md` — new capability joins the audited list

**Files:**
- Modify: `brain.security.md`

- [ ] **Step 1: Read the file first** to locate the exact current line numbers for the T5 scoped-token control, the 90-day rotation / quarterly-scope-audit bullet, and the classification-tier list — confirm against the actual file rather than the research citations, which may have shifted.

- [ ] **Step 2: Add the new capability to the audited capability list**

Find the sentence describing 90-day key rotation and quarterly scope-audit "against the brain.workflows.md §6 capability list" (research cites `brain.security.md:73`). Add a clause naming the new capability explicitly:

```markdown
This list now includes the Revenue Reader's per-platform scoped tokens ([ADR-0018](adr/ADR-0018-cross-platform-read-access.md)) — same rotation and audit cadence, under a distinct token-naming convention from Guardian's health-check tokens so the two are never interchangeable.
```

- [ ] **Step 3: Add a short classification-handling note**

Near the four-tier classification description (`public→ecosystem→restricted→sensitive`), add one sentence noting the new double-enforcement point:

```markdown
The Revenue Reader enforces this twice: every dot-revenue/v1 response must declare its own classification, and a response exceeding the enrolling platform's manifest-declared `classification_ceiling` is rejected outright, not merely downgraded ([ADR-0018](adr/ADR-0018-cross-platform-read-access.md)).
```

- [ ] **Step 4: Verify**

Run: `grep -n "Revenue Reader\|ADR-0018" brain.security.md`
Expected: at least 2 matches.

- [ ] **Step 5: Commit**

```bash
git add brain.security.md
git commit -m "docs(brain.security): document Revenue Reader's token audit membership and double classification enforcement"
```

---

## Final verification

- [ ] Run the full new service's test suite: `cd services/revenue-reader && npm test` — expect all tests passing (27 tests across 3 files: 8 registry + 10 contract + 9 client).
- [ ] Confirm no other service's files were touched: `git diff --stat main -- services/` should show only `services/revenue-reader/` as new, nothing else modified.
- [ ] Confirm every doc cross-reference resolves to a real path: `grep -rn "revenue-reader\|ADR-0018" brain.*.md services/revenue-reader/README.md adr/ | wc -l` should be ≥ 6 (one or more per Task 4–7 file).
- [ ] Confirm the CI matrix and coverage-of-suites list both include `revenue-reader`: `grep -c "revenue-reader" .github/workflows/tests.yml` should be ≥ 2.
