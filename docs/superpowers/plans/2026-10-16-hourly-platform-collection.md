# Hourly Platform Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `services/platform-collector` — an hourly job, run from Dot.Brain's own GitHub Actions, that fetches each enrolled platform's `dot-guardian/v1` health document and records one observation per platform to Dot.Memory — per `docs/superpowers/specs/2026-10-16-hourly-platform-collection-design.md`.

**Architecture:** A new standalone service following the exact conventions of `services/guardian`, `services/blupin-context`, and `services/revenue-reader` (ES modules, `node --test`, injectable `fetch`/env/clock/sleep, self-contained — no cross-service imports). Five small modules: a strict manifest registry, a classifying health fetcher, an observation-record builder, a retrying Dot.Memory writer, and a collector that ties them together behind a CLI. A scheduled workflow runs the CLI hourly; enrollment is a manifest in `platforms/collector/`.

**Tech Stack:** Node.js ≥ 22.5 (ESM), built-in `node:test` + `node:assert/strict`, no external dependencies.

## Global Constraints

- Runs from Dot.Brain's GitHub Actions, never the shared cPanel crontab (spec Context; F-INFRA-2026-001).
- The wire format is the existing `dot-guardian/v1` document; no new contract (spec Non-goals).
- Records only — no remediation, no incident creation, no deploys (spec Non-goals).
- `health_url` must start with `https://`; manifest keys are strict (required keys non-empty strings, unrecognized keys rejected, `timeout_ms` a positive finite number, `platform` matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, duplicate `platform` ids rejected) (spec §1).
- Failure kinds are exactly `unreachable | platform_error | maintenance | access | config | contract` (spec §2; ADR-0016).
- An unset token is recorded as `config`, never skipped (spec §2).
- Observation envelope fields and values are exactly those in spec §3; every string must fit Dot.Memory's 255-character limit; `message`/string metrics truncated to 240 characters, ≤ 32 metric keys per check, ≤ 64 checks per observation.
- Exit codes: `0` all observations recorded (platforms may be down), `1` any observation unrecorded or Dot.Memory unconfigured on a real run, `2` usage error / invalid manifest / no manifests / crash (spec §4).
- A platform being down keeps the run green; inability to record turns it red (spec §4).
- No cross-service imports: the health-shape check is duplicated from `services/guardian/src/health.js`, not imported.
- No new secrets: the workflow reuses `DOT_MEMORY_TOKEN` and `DOT_MINES_GUARDIAN_TOKEN` (spec §1).
- Never run `git push` to `main`; this work goes to its feature branch and a PR.

---

## File Structure

```
services/platform-collector/
  package.json
  README.md
  src/
    registry.js     # REQUIRED_KEYS, DEFAULTS, validateManifest, loadManifests
    fetch.js        # VALID_STATUSES, FAILURE_KINDS, fetchHealth
    record.js       # buildObservation
    memory.js       # memoryConfig, writeObservation
    collect.js      # collect, formatTable
    cli.js          # bin entry point: collect
  test/
    registry.test.js
    fetch.test.js
    record.test.js
    memory.test.js
    collect.test.js
    enrollment.test.js

platforms/collector/
  dot-mines.json
  blupin.json

.github/workflows/platform-collector.yml     # new
.github/workflows/tests.yml                  # modified: matrix + covered string
adr/ADR-0019-hourly-platform-collection.md   # new
brain.architecture.md                        # modified: diagram, component row, change log
brain.security.md                            # modified: token-audit sentence
```

---

### Task 1: Manifest registry

**Files:**
- Create: `services/platform-collector/package.json`
- Create: `services/platform-collector/src/registry.js`
- Test: `services/platform-collector/test/registry.test.js`

**Interfaces:**
- Produces:
  - `REQUIRED_KEYS: string[]` — `['platform', 'health_url', 'token_env']`
  - `DEFAULTS: {timeout_ms: number}` — `{ timeout_ms: 15000 }`
  - `validateManifest(raw: unknown) => {platform: string, health_url: string, token_env: string, timeout_ms: number}` — throws `Error` on any violation
  - `loadManifests(dir: string, readDirImpl?, readFileImpl?) => Manifest[]` — throws with the filename on any bad file or duplicate platform

- [ ] **Step 1: Create the package manifest**

```json
{
  "name": "@dot-brain/platform-collector",
  "version": "1.0.0",
  "description": "Hourly collector: fetches each enrolled platform's dot-guardian/v1 health document and records one observation per platform to Dot.Memory, so Brain's picture of the live platforms is never stale. Records only; never remediates (that is Guardian). See ../../docs/superpowers/specs/2026-10-16-hourly-platform-collection-design.md.",
  "type": "module",
  "bin": { "platform-collector": "./src/cli.js" },
  "scripts": { "test": "node --test" },
  "engines": { "node": ">=22.5.0" }
}
```

- [ ] **Step 2: Write the failing tests**

```js
// services/platform-collector/test/registry.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, loadManifests, REQUIRED_KEYS, DEFAULTS } from '../src/registry.js';

const VALID = {
  platform: 'dot-mines',
  health_url: 'https://mines.infodot.co.za/guardian/health',
  token_env: 'DOT_MINES_GUARDIAN_TOKEN',
};

test('REQUIRED_KEYS lists platform, health_url, and token_env', () => {
  assert.deepEqual(REQUIRED_KEYS, ['platform', 'health_url', 'token_env']);
});

test('validateManifest fills in the default timeout', () => {
  assert.equal(validateManifest(VALID).timeout_ms, DEFAULTS.timeout_ms);
  assert.equal(DEFAULTS.timeout_ms, 15000);
});

test('validateManifest preserves an explicit timeout_ms', () => {
  assert.equal(validateManifest({ ...VALID, timeout_ms: 5000 }).timeout_ms, 5000);
});

test('validateManifest throws listing every missing required key', () => {
  assert.throws(() => validateManifest({ platform: 'dot-mines' }), /health_url, token_env/);
});

test('validateManifest rejects a required key that is present but not a non-empty string', () => {
  for (const platform of [{ x: 1 }, 42, null, '']) {
    assert.throws(
      () => validateManifest({ ...VALID, platform }),
      /missing required key\(s\): platform/,
      `expected ${JSON.stringify(platform)} to be rejected`,
    );
  }
});

test('validateManifest rejects a manifest that is not a JSON object', () => {
  for (const raw of [null, [], 'x', 7]) {
    assert.throws(() => validateManifest(raw), /must be a JSON object/);
  }
});

test('validateManifest rejects an unrecognized key', () => {
  assert.throws(() => validateManifest({ ...VALID, Timeout_Ms: 1 }), /unrecognized key\(s\): Timeout_Ms/);
});

test('validateManifest rejects a platform id that is unsafe or too long', () => {
  for (const platform of ['has space', 'a|b', '-lead', 'x'.repeat(65), 'a\nb']) {
    assert.throws(
      () => validateManifest({ ...VALID, platform }),
      /platform must match/,
      `expected ${JSON.stringify(platform)} to be rejected`,
    );
  }
});

test('validateManifest rejects a non-https health_url', () => {
  assert.throws(
    () => validateManifest({ ...VALID, health_url: 'http://mines.infodot.co.za/guardian/health' }),
    /health_url must use https/,
  );
});

test('validateManifest rejects a timeout_ms that is not a positive finite number', () => {
  for (const timeout_ms of ['abc', -1, 0, null, Infinity]) {
    assert.throws(
      () => validateManifest({ ...VALID, timeout_ms }),
      /timeout_ms must be a positive number/,
      `expected ${JSON.stringify(timeout_ms)} to be rejected`,
    );
  }
});

function fakeFs(files) {
  return {
    readDirImpl: () => Object.keys(files),
    readFileImpl: (path) => files[path.split('/').pop()],
  };
}

test('loadManifests parses and validates every .json file and ignores the rest', () => {
  const { readDirImpl, readFileImpl } = fakeFs({
    'dot-mines.json': JSON.stringify(VALID),
    'blupin.json': JSON.stringify({ ...VALID, platform: 'blupin', token_env: 'DOT_MEMORY_TOKEN' }),
    'README.md': 'not a manifest',
  });
  const manifests = loadManifests('dir', readDirImpl, readFileImpl);
  assert.deepEqual(manifests.map((m) => m.platform), ['dot-mines', 'blupin']);
});

test('loadManifests names the file when a manifest is invalid', () => {
  const { readDirImpl, readFileImpl } = fakeFs({ 'broken.json': JSON.stringify({ platform: 'x' }) });
  assert.throws(() => loadManifests('dir', readDirImpl, readFileImpl), /broken\.json/);
});

test('loadManifests names the file when a manifest is not valid JSON', () => {
  const { readDirImpl, readFileImpl } = fakeFs({ 'broken.json': '{not json' });
  assert.throws(() => loadManifests('dir', readDirImpl, readFileImpl), /broken\.json/);
});

test('loadManifests rejects two manifests that declare the same platform', () => {
  const { readDirImpl, readFileImpl } = fakeFs({
    'a.json': JSON.stringify(VALID),
    'b.json': JSON.stringify(VALID),
  });
  assert.throws(
    () => loadManifests('dir', readDirImpl, readFileImpl),
    /b\.json: platform "dot-mines" is already declared by a\.json/,
  );
});

test('loadManifests returns an empty list for a directory with no manifests', () => {
  const { readDirImpl, readFileImpl } = fakeFs({ 'README.md': 'x' });
  assert.deepEqual(loadManifests('dir', readDirImpl, readFileImpl), []);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd services/platform-collector && npm test`
Expected: FAIL — `Cannot find module '../src/registry.js'`

- [ ] **Step 4: Implement the registry**

```js
// services/platform-collector/src/registry.js
import { readdirSync, readFileSync } from 'node:fs';

/**
 * Enrolling a platform is one manifest file (design spec §1) -- this is the
 * only place that decides whether it is well-formed. Strict by design:
 * services/revenue-reader's review found that truthy-only checks, silently
 * dropped unknown keys, and unvalidated numbers each let a typo become
 * silent misbehaviour.
 */
export const REQUIRED_KEYS = ['platform', 'health_url', 'token_env'];

export const DEFAULTS = { timeout_ms: 15000 };

const ALLOWED_KEYS = [...REQUIRED_KEYS, ...Object.keys(DEFAULTS)];

// The platform id is embedded in event_id, subject_id, and a markdown table,
// so it must be plain and bounded.
const PLATFORM_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * @param {unknown} raw
 * @returns {{platform: string, health_url: string, token_env: string, timeout_ms: number}}
 */
export function validateManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('manifest must be a JSON object');
  }

  const missing = REQUIRED_KEYS.filter((key) => typeof raw[key] !== 'string' || raw[key] === '');
  if (missing.length > 0) {
    throw new Error(`manifest missing required key(s): ${missing.join(', ')}`);
  }

  const unknown = Object.keys(raw).filter((key) => !ALLOWED_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new Error(`manifest has unrecognized key(s): ${unknown.join(', ')}`);
  }

  const manifest = { ...DEFAULTS, ...raw };

  if (!PLATFORM_PATTERN.test(manifest.platform)) {
    throw new Error(`platform must match ${PLATFORM_PATTERN}, got ${JSON.stringify(manifest.platform)}`);
  }
  if (!manifest.health_url.startsWith('https://')) {
    throw new Error(`health_url must use https, got ${JSON.stringify(manifest.health_url)}`);
  }
  if (typeof manifest.timeout_ms !== 'number' || !Number.isFinite(manifest.timeout_ms) || manifest.timeout_ms <= 0) {
    throw new Error(`timeout_ms must be a positive number, got ${JSON.stringify(manifest.timeout_ms)}`);
  }

  return manifest;
}

/**
 * Loads and validates every manifest in a directory. One bad manifest, or two
 * declaring the same platform, fails loudly with its filename rather than
 * being skipped or silently shadowing another.
 *
 * @param {string} dir
 * @param {typeof readdirSync} [readDirImpl]
 * @param {typeof readFileSync} [readFileImpl]
 */
export function loadManifests(dir, readDirImpl = readdirSync, readFileImpl = readFileSync) {
  const loaded = readDirImpl(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      try {
        return { name, manifest: validateManifest(JSON.parse(readFileImpl(`${dir}/${name}`, 'utf8'))) };
      } catch (error) {
        throw new Error(`${name}: ${error.message}`);
      }
    });

  const declaredBy = new Map();
  for (const { name, manifest } of loaded) {
    if (declaredBy.has(manifest.platform)) {
      throw new Error(`${name}: platform "${manifest.platform}" is already declared by ${declaredBy.get(manifest.platform)}`);
    }
    declaredBy.set(manifest.platform, name);
  }

  return loaded.map(({ manifest }) => manifest);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd services/platform-collector && npm test`
Expected: PASS (15 tests)

- [ ] **Step 6: Commit**

```bash
git add services/platform-collector/package.json services/platform-collector/src/registry.js services/platform-collector/test/registry.test.js
git commit -m "feat(platform-collector): add strict manifest registry"
```

---

### Task 2: Health fetch and failure classification

**Files:**
- Create: `services/platform-collector/src/fetch.js`
- Test: `services/platform-collector/test/fetch.test.js`

**Interfaces:**
- Consumes: a validated manifest `{platform, health_url, token_env, timeout_ms}` (Task 1)
- Produces:
  - `VALID_STATUSES: string[]` — `['healthy', 'warning', 'critical', 'unknown']`
  - `FAILURE_KINDS: string[]` — `['unreachable', 'platform_error', 'maintenance', 'access', 'config', 'contract']`
  - `fetchHealth(manifest, {fetchImpl?, env?}) => Promise<{reachable: true, status, generated_at: string|null, checks: object} | {reachable: false, kind, reason: string}>` — never throws

- [ ] **Step 1: Write the failing tests**

```js
// services/platform-collector/test/fetch.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchHealth, FAILURE_KINDS, VALID_STATUSES } from '../src/fetch.js';

const MANIFEST = {
  platform: 'dot-mines',
  health_url: 'https://mines.test/guardian/health',
  token_env: 'MINES_TOKEN',
  timeout_ms: 15000,
};
const ENV = { MINES_TOKEN: 'tok-1' };

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const failing = (status) => ({ ok: false, status });

const GOOD_DOC = {
  platform: 'dot-mines',
  contract: 'dot-guardian/v1',
  generated_at: '2026-10-16T19:00:00Z',
  status: 'warning',
  checks: { queue: { status: 'healthy', message: 'ok', metrics: { pending_jobs: 3 } } },
};

test('the vocabularies match ADR-0016 / Guardian', () => {
  assert.deepEqual(VALID_STATUSES, ['healthy', 'warning', 'critical', 'unknown']);
  assert.deepEqual(FAILURE_KINDS, ['unreachable', 'platform_error', 'maintenance', 'access', 'config', 'contract']);
});

test('fetchHealth sends the bearer token to the manifest URL and returns the document', async () => {
  let seenUrl;
  let seenHeaders;
  const fetchImpl = async (url, options) => {
    seenUrl = url;
    seenHeaders = options.headers;
    return ok(GOOD_DOC);
  };
  const result = await fetchHealth(MANIFEST, { fetchImpl, env: ENV });
  assert.deepEqual(result, {
    reachable: true,
    status: 'warning',
    generated_at: '2026-10-16T19:00:00Z',
    checks: GOOD_DOC.checks,
  });
  assert.equal(seenUrl, MANIFEST.health_url);
  assert.equal(seenHeaders.Authorization, 'Bearer tok-1');
});

test('fetchHealth records an unset token as kind config without calling fetch', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; };
  const result = await fetchHealth(MANIFEST, { fetchImpl, env: {} });
  assert.equal(result.reachable, false);
  assert.equal(result.kind, 'config');
  assert.match(result.reason, /MINES_TOKEN/);
  assert.equal(called, false);
});

test('fetchHealth classifies HTTP statuses', async () => {
  const cases = [[401, 'access'], [403, 'access'], [404, 'config'], [503, 'maintenance'], [500, 'platform_error'], [502, 'platform_error'], [429, 'access']];
  for (const [status, kind] of cases) {
    const result = await fetchHealth(MANIFEST, { fetchImpl: async () => failing(status), env: ENV });
    assert.equal(result.reachable, false);
    assert.equal(result.kind, kind, `HTTP ${status}`);
    assert.match(result.reason, new RegExp(`HTTP ${status}`));
  }
});

test('fetchHealth classifies a thrown fetch as unreachable', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  const result = await fetchHealth(MANIFEST, { fetchImpl, env: ENV });
  assert.equal(result.reachable, false);
  assert.equal(result.kind, 'unreachable');
  assert.match(result.reason, /ECONNREFUSED/);
});

test('fetchHealth classifies a non-JSON body as contract', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });
  const result = await fetchHealth(MANIFEST, { fetchImpl, env: ENV });
  assert.equal(result.kind, 'contract');
  assert.match(result.reason, /not JSON/);
});

for (const name of ['TimeoutError', 'AbortError']) {
  test(`fetchHealth classifies a body-read ${name} as unreachable, not contract`, async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name }); },
    });
    const result = await fetchHealth(MANIFEST, { fetchImpl, env: ENV });
    assert.equal(result.reachable, false);
    assert.equal(result.kind, 'unreachable');
    assert.match(result.reason, /body read failed/);
  });
}

test('fetchHealth classifies a body that is not dot-guardian/v1-shaped as contract', async () => {
  const bad = [
    null,
    {},
    { status: 'healthy' },
    { status: 'great', checks: {} },
    { status: 'healthy', checks: null },
    { status: 'healthy', checks: [] },
  ];
  for (const body of bad) {
    const result = await fetchHealth(MANIFEST, { fetchImpl: async () => ok(body), env: ENV });
    assert.equal(result.reachable, false, JSON.stringify(body));
    assert.equal(result.kind, 'contract', JSON.stringify(body));
  }
});

test('fetchHealth reports a missing or non-string generated_at as null', async () => {
  const doc = { status: 'healthy', checks: {}, generated_at: 12345 };
  const result = await fetchHealth(MANIFEST, { fetchImpl: async () => ok(doc), env: ENV });
  assert.equal(result.reachable, true);
  assert.equal(result.generated_at, null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/platform-collector && node --test test/fetch.test.js`
Expected: FAIL — `Cannot find module '../src/fetch.js'`

- [ ] **Step 3: Implement the fetcher**

```js
// services/platform-collector/src/fetch.js

export const VALID_STATUSES = ['healthy', 'warning', 'critical', 'unknown'];

/**
 * Why a health fetch failed (ADR-0016), as services/guardian/src/health.js
 * implements it -- duplicated here per this repo's convention that every
 * service is self-contained. The words must keep meaning the same thing in
 * both places.
 *
 *   unreachable    -- nothing answered, or the answer never finished: DNS,
 *                     connection refused, timeout (including a stalled body)
 *   platform_error -- answered with 5xx: the app is failing
 *   maintenance    -- answered 503: almost always our own deploy
 *   access         -- answered 401/403 (or another refusal): reached and refused
 *   config         -- 404, or no token: we are pointed at the wrong place
 *   contract       -- answered, but not with a dot-guardian/v1 document
 */
export const FAILURE_KINDS = ['unreachable', 'platform_error', 'maintenance', 'access', 'config', 'contract'];

function kindForStatus(status) {
  if (status === 401 || status === 403) return 'access';
  if (status === 404) return 'config';
  if (status === 503) return 'maintenance';
  if (status >= 500) return 'platform_error';
  return 'access';
}

/**
 * Fetch one platform's dot-guardian/v1 health document. Never throws: every
 * failure comes back as {reachable: false, kind, reason}. An unset token is
 * recorded as `config` rather than skipped -- a silent hole in an hourly
 * series is worse than a recorded one.
 *
 * @param {{health_url: string, token_env: string, timeout_ms: number}} manifest
 * @param {{fetchImpl?: typeof fetch, env?: Record<string, string|undefined>}} [opts]
 */
export async function fetchHealth(manifest, { fetchImpl = fetch, env = process.env } = {}) {
  const token = env[manifest.token_env];
  if (!token) {
    return { reachable: false, kind: 'config', reason: `token env ${manifest.token_env} is not set` };
  }

  let response;
  try {
    response = await fetchImpl(manifest.health_url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(manifest.timeout_ms),
    });
  } catch (error) {
    return { reachable: false, kind: 'unreachable', reason: `fetch failed: ${error.message}` };
  }

  if (!response.ok) {
    return { reachable: false, kind: kindForStatus(response.status), reason: `HTTP ${response.status}` };
  }

  let doc;
  try {
    doc = await response.json();
  } catch (error) {
    // The timeout signal stays attached to the body: a platform that sends
    // headers and then stalls rejects here with a TimeoutError/AbortError.
    // That is "the answer never finished" (unreachable per ADR-0016), not
    // "answered with the wrong document" (contract).
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      return { reachable: false, kind: 'unreachable', reason: `body read failed: ${error?.message ?? error}` };
    }
    return { reachable: false, kind: 'contract', reason: 'response body was not JSON' };
  }

  if (
    !doc
    || typeof doc.checks !== 'object'
    || doc.checks === null
    || Array.isArray(doc.checks)
    || !VALID_STATUSES.includes(doc.status)
  ) {
    return { reachable: false, kind: 'contract', reason: 'response did not match the dot-guardian/v1 contract' };
  }

  return {
    reachable: true,
    status: doc.status,
    generated_at: typeof doc.generated_at === 'string' ? doc.generated_at : null,
    checks: doc.checks,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd services/platform-collector && node --test test/fetch.test.js`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add services/platform-collector/src/fetch.js services/platform-collector/test/fetch.test.js
git commit -m "feat(platform-collector): add health fetch with ADR-0016 failure classification"
```

---

### Task 3: Observation record

**Files:**
- Create: `services/platform-collector/src/record.js`
- Test: `services/platform-collector/test/record.test.js`

**Interfaces:**
- Consumes: `fetchHealth` result shape and `VALID_STATUSES` (Task 2)
- Produces: `buildObservation(manifest: {platform: string}, result, now?: Date) => object` — the Dot.Memory `POST /api/intelligence/events` body (spec §3)

- [ ] **Step 1: Write the failing tests**

```js
// services/platform-collector/test/record.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildObservation } from '../src/record.js';

const MANIFEST = { platform: 'dot-mines' };
const NOW = new Date('2026-10-16T19:17:42.000Z');

const UP = {
  reachable: true,
  status: 'warning',
  generated_at: '2026-10-16T19:17:00Z',
  checks: {
    queue: { status: 'healthy', message: 'ok', metrics: { pending_jobs: 3 } },
    integration_sync: { status: 'warning', message: 'slow', metrics: {} },
  },
};
const DOWN = { reachable: false, kind: 'maintenance', reason: 'HTTP 503' };

test('the envelope carries every field Dot.Memory requires, with the documented values', () => {
  const record = buildObservation(MANIFEST, UP, NOW);
  assert.equal(record.loop_id, 'collect-dot-mines-2026-10-16');
  assert.equal(record.event_id, 'collect-dot-mines-2026101619');
  assert.equal(record.platform, 'dot-brain');
  assert.equal(record.source, 'platform-collector');
  assert.equal(record.subject_type, 'platform');
  assert.equal(record.subject_id, 'dot-mines');
  assert.equal(record.subject_label, 'dot-mines hourly state');
  assert.equal(record.occurred_at, '2026-10-16T19:17:42.000Z');
  assert.equal(record.signature, 'status:warning');
});

test('every string in the envelope fits Dot.Memory\'s 255-character limit', () => {
  const huge = { reachable: false, kind: 'contract', reason: 'x'.repeat(5000) };
  const record = buildObservation(MANIFEST, huge, NOW);
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string') assert.ok(value.length <= 255, `${key} is ${value.length} chars`);
  }
});

test('a reachable document is summarised in detail', () => {
  const { detail } = buildObservation(MANIFEST, UP, NOW);
  assert.equal(detail.reachable, true);
  assert.equal(detail.status, 'warning');
  assert.equal(detail.kind, null);
  assert.equal(detail.reason, null);
  assert.equal(detail.generated_at, '2026-10-16T19:17:00Z');
  assert.equal(detail.check_count, 2);
  assert.deepEqual(detail.checks.queue, { status: 'healthy', message: 'ok', metrics: { pending_jobs: 3 } });
});

test('a failure is recorded as data, with a failure signature', () => {
  const record = buildObservation(MANIFEST, DOWN, NOW);
  assert.equal(record.signature, 'failure:maintenance');
  assert.equal(record.detail.reachable, false);
  assert.equal(record.detail.status, null);
  assert.equal(record.detail.kind, 'maintenance');
  assert.equal(record.detail.reason, 'HTTP 503');
  assert.equal(record.detail.generated_at, null);
  assert.equal(record.detail.check_count, 0);
  assert.deepEqual(record.detail.checks, {});
});

test('event_id is stable within a UTC hour and changes across hours', () => {
  const a = buildObservation(MANIFEST, UP, new Date('2026-10-16T19:00:01.000Z'));
  const b = buildObservation(MANIFEST, UP, new Date('2026-10-16T19:59:59.000Z'));
  const c = buildObservation(MANIFEST, UP, new Date('2026-10-16T20:00:00.000Z'));
  assert.equal(a.event_id, b.event_id);
  assert.notEqual(a.event_id, c.event_id);
});

test('loop_id changes across UTC days', () => {
  const a = buildObservation(MANIFEST, UP, new Date('2026-10-16T23:59:00.000Z'));
  const b = buildObservation(MANIFEST, UP, new Date('2026-10-17T00:01:00.000Z'));
  assert.notEqual(a.loop_id, b.loop_id);
});

test('long messages are truncated to 240 characters', () => {
  const result = { ...UP, checks: { queue: { status: 'healthy', message: 'm'.repeat(1000), metrics: {} } } };
  assert.equal(buildObservation(MANIFEST, result, NOW).detail.checks.queue.message.length, 240);
});

test('only scalar metrics survive; strings are clipped; objects, arrays, null and non-finite numbers are dropped', () => {
  const metrics = {
    count: 3,
    ratio: 0.5,
    flag: true,
    label: 's'.repeat(1000),
    nested: { a: 1 },
    list: [1, 2],
    nothing: null,
    nan: NaN,
    inf: Infinity,
  };
  const result = { ...UP, checks: { queue: { status: 'healthy', message: '', metrics } } };
  const kept = buildObservation(MANIFEST, result, NOW).detail.checks.queue.metrics;
  assert.deepEqual(Object.keys(kept).sort(), ['count', 'flag', 'label', 'ratio']);
  assert.equal(kept.label.length, 240);
});

test('at most 32 metric keys are kept per check', () => {
  const metrics = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i]));
  const result = { ...UP, checks: { queue: { status: 'healthy', message: '', metrics } } };
  assert.equal(Object.keys(buildObservation(MANIFEST, result, NOW).detail.checks.queue.metrics).length, 32);
});

test('at most 64 checks are kept but check_count reports the true number', () => {
  const checks = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`c${i}`, { status: 'healthy', message: '', metrics: {} }]));
  const { detail } = buildObservation(MANIFEST, { ...UP, checks }, NOW);
  assert.equal(detail.check_count, 100);
  assert.equal(Object.keys(detail.checks).length, 64);
});

test('an invalid check status becomes unknown and a non-string message becomes empty', () => {
  const result = { ...UP, checks: { queue: { status: 'great', message: 42, metrics: 'nope' } } };
  assert.deepEqual(buildObservation(MANIFEST, result, NOW).detail.checks.queue, { status: 'unknown', message: '', metrics: {} });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/platform-collector && node --test test/record.test.js`
Expected: FAIL — `Cannot find module '../src/record.js'`

- [ ] **Step 3: Implement the record builder**

```js
// services/platform-collector/src/record.js
import { VALID_STATUSES } from './fetch.js';

const MAX_TEXT = 240;
const MAX_METRIC_KEYS = 32;
const MAX_CHECKS = 64;

function clip(value) {
  return value.length > MAX_TEXT ? value.slice(0, MAX_TEXT) : value;
}

function compactMetrics(metrics) {
  const kept = {};
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) return kept;

  let count = 0;
  for (const [key, value] of Object.entries(metrics)) {
    if (count >= MAX_METRIC_KEYS) break;
    if (typeof value === 'number' && Number.isFinite(value)) {
      kept[key] = value;
    } else if (typeof value === 'boolean') {
      kept[key] = value;
    } else if (typeof value === 'string') {
      kept[key] = clip(value);
    } else {
      continue;
    }
    count += 1;
  }
  return kept;
}

/**
 * Builds the Dot.Memory `POST /api/intelligence/events` body for one platform
 * (design spec §3) -- the same envelope services/blupin-context uses and
 * Dot.Memory's LoopController already validates. `event_id` embeds the UTC
 * hour, so a duplicate or late run inside the same hour updates the existing
 * row instead of adding one.
 *
 * @param {{platform: string}} manifest
 * @param {object} result a fetchHealth() result
 * @param {Date} [now]
 */
export function buildObservation(manifest, result, now = new Date()) {
  const iso = now.toISOString();
  const day = iso.slice(0, 10);
  const hour = iso.replace(/[-:T]/g, '').slice(0, 10);

  const entries = result.reachable ? Object.entries(result.checks) : [];
  const checks = {};
  for (const [key, check] of entries.slice(0, MAX_CHECKS)) {
    checks[key] = {
      status: VALID_STATUSES.includes(check?.status) ? check.status : 'unknown',
      message: typeof check?.message === 'string' ? clip(check.message) : '',
      metrics: compactMetrics(check?.metrics),
    };
  }

  return {
    loop_id: `collect-${manifest.platform}-${day}`,
    event_id: `collect-${manifest.platform}-${hour}`,
    platform: 'dot-brain',
    source: 'platform-collector',
    subject_type: 'platform',
    subject_id: manifest.platform,
    subject_label: `${manifest.platform} hourly state`,
    occurred_at: iso,
    signature: result.reachable ? `status:${result.status}` : `failure:${result.kind}`,
    detail: {
      reachable: result.reachable,
      status: result.reachable ? result.status : null,
      kind: result.reachable ? null : result.kind,
      reason: result.reachable ? null : clip(result.reason),
      generated_at: result.reachable ? result.generated_at : null,
      check_count: entries.length,
      checks,
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd services/platform-collector && node --test test/record.test.js`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add services/platform-collector/src/record.js services/platform-collector/test/record.test.js
git commit -m "feat(platform-collector): add the Dot.Memory observation record"
```

---

### Task 4: Dot.Memory writer with retry

**Files:**
- Create: `services/platform-collector/src/memory.js`
- Test: `services/platform-collector/test/memory.test.js`

**Interfaces:**
- Consumes: the observation body from Task 3
- Produces:
  - `memoryConfig(env?) => {enabled: true, url: string, token: string} | {enabled: false}` — trailing slashes stripped from the URL
  - `writeObservation(cfg, record, {fetchImpl?, sleep?, delaysMs?}) => Promise<{ok: true, attempts: number} | {ok: false, reason: string, attempts?: number}>` — never throws; retries network errors and HTTP 5xx after each delay in `delaysMs` (default `[2000, 5000]`); does not retry 4xx

- [ ] **Step 1: Write the failing tests**

```js
// services/platform-collector/test/memory.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryConfig, writeObservation } from '../src/memory.js';

const CFG = { enabled: true, url: 'https://memory.test', token: 'tok' };
const RECORD = { event_id: 'collect-dot-mines-2026101619', detail: {} };

const reply = (status) => ({ ok: status >= 200 && status < 300, status, json: async () => ({}) });

test('memoryConfig is disabled when either env var is missing', () => {
  assert.deepEqual(memoryConfig({}), { enabled: false });
  assert.deepEqual(memoryConfig({ DOT_MEMORY_URL: 'https://m.test' }), { enabled: false });
  assert.deepEqual(memoryConfig({ DOT_MEMORY_TOKEN: 't' }), { enabled: false });
});

test('memoryConfig is enabled and strips trailing slashes', () => {
  assert.deepEqual(
    memoryConfig({ DOT_MEMORY_URL: 'https://m.test//', DOT_MEMORY_TOKEN: 't' }),
    { enabled: true, url: 'https://m.test', token: 't' },
  );
});

test('writeObservation posts the record to the events endpoint with the bearer token', async () => {
  let seen;
  const fetchImpl = async (url, options) => {
    seen = { url, options };
    return reply(201);
  };
  const result = await writeObservation(CFG, RECORD, { fetchImpl, sleep: async () => {} });
  assert.deepEqual(result, { ok: true, attempts: 1 });
  assert.equal(seen.url, 'https://memory.test/api/intelligence/events');
  assert.equal(seen.options.method, 'POST');
  assert.equal(seen.options.headers.Authorization, 'Bearer tok');
  assert.equal(seen.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(seen.options.body), RECORD);
});

test('writeObservation accepts 200 (an idempotent update) as success', async () => {
  const result = await writeObservation(CFG, RECORD, { fetchImpl: async () => reply(200), sleep: async () => {} });
  assert.equal(result.ok, true);
});

test('writeObservation reports not-ok without calling fetch when Memory is disabled', async () => {
  let called = false;
  const result = await writeObservation({ enabled: false }, RECORD, { fetchImpl: async () => { called = true; } });
  assert.equal(result.ok, false);
  assert.match(result.reason, /not configured/);
  assert.equal(called, false);
});

test('writeObservation retries a 5xx after the configured delay and then succeeds', async () => {
  const replies = [reply(502), reply(201)];
  const slept = [];
  const result = await writeObservation(CFG, RECORD, {
    fetchImpl: async () => replies.shift(),
    sleep: async (ms) => { slept.push(ms); },
  });
  assert.deepEqual(result, { ok: true, attempts: 2 });
  assert.deepEqual(slept, [2000]);
});

test('writeObservation retries a thrown network error', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) throw new Error('ECONNRESET');
    return reply(201);
  };
  const result = await writeObservation(CFG, RECORD, { fetchImpl, sleep: async () => {} });
  assert.deepEqual(result, { ok: true, attempts: 2 });
});

test('writeObservation gives up after the final delay and reports the last failure', async () => {
  const slept = [];
  let calls = 0;
  const result = await writeObservation(CFG, RECORD, {
    fetchImpl: async () => { calls += 1; return reply(500); },
    sleep: async (ms) => { slept.push(ms); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 3);
  assert.match(result.reason, /HTTP 500/);
  assert.equal(calls, 3);
  assert.deepEqual(slept, [2000, 5000]);
});

test('writeObservation does not retry a 4xx', async () => {
  let calls = 0;
  const result = await writeObservation(CFG, RECORD, {
    fetchImpl: async () => { calls += 1; return reply(422); },
    sleep: async () => { throw new Error('must not sleep'); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 1);
  assert.match(result.reason, /HTTP 422/);
  assert.equal(calls, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/platform-collector && node --test test/memory.test.js`
Expected: FAIL — `Cannot find module '../src/memory.js'`

- [ ] **Step 3: Implement the writer**

```js
// services/platform-collector/src/memory.js

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Same shape as services/revenue-intelligence/src/memory-client.js and
 * services/blupin-context: DOT_MEMORY_URL + DOT_MEMORY_TOKEN, honest
 * degradation (an unconfigured Memory is reported, never treated as success).
 */
export function memoryConfig(env = process.env) {
  const url = env.DOT_MEMORY_URL;
  const token = env.DOT_MEMORY_TOKEN;

  return url && token
    ? { enabled: true, url: url.replace(/\/+$/, ''), token }
    : { enabled: false };
}

/**
 * POST one observation to Dot.Memory's intelligence events endpoint. Never
 * throws. Network errors and 5xx are retried after each delay in `delaysMs`
 * (an hour lost to one transient 502 is exactly the staleness this job exists
 * to prevent); a 4xx means the record itself is wrong, so retrying is futile.
 *
 * @param {{enabled: boolean, url?: string, token?: string}} cfg
 * @param {object} record
 * @param {{fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>, delaysMs?: number[]}} [opts]
 */
export async function writeObservation(cfg, record, { fetchImpl = fetch, sleep = defaultSleep, delaysMs = [2000, 5000] } = {}) {
  if (!cfg.enabled) {
    return { ok: false, reason: 'Dot.Memory is not configured' };
  }

  let reason = 'unknown failure';
  for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
    try {
      const response = await fetchImpl(`${cfg.url}/api/intelligence/events`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(record),
        signal: AbortSignal.timeout(15000),
      });

      if (response.ok) {
        return { ok: true, attempts: attempt + 1 };
      }
      reason = `Dot.Memory answered HTTP ${response.status}`;
      if (response.status < 500) {
        return { ok: false, reason, attempts: attempt + 1 };
      }
    } catch (error) {
      reason = `Dot.Memory request failed: ${error.message}`;
    }

    if (attempt < delaysMs.length) {
      await sleep(delaysMs[attempt]);
    }
  }

  return { ok: false, reason, attempts: delaysMs.length + 1 };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd services/platform-collector && node --test test/memory.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add services/platform-collector/src/memory.js services/platform-collector/test/memory.test.js
git commit -m "feat(platform-collector): add retrying Dot.Memory observation writer"
```

---

### Task 5: Collector and CLI

**Files:**
- Create: `services/platform-collector/src/collect.js`
- Create: `services/platform-collector/src/cli.js`
- Test: `services/platform-collector/test/collect.test.js`

**Interfaces:**
- Consumes: `fetchHealth` (Task 2), `buildObservation` (Task 3), `writeObservation` / `memoryConfig` (Task 4), `loadManifests` (Task 1)
- Produces:
  - `collect({manifests, cfg, fetchImpl?, env?, now?, sleep?, dryRun?}) => Promise<{rows: Array<{manifest, result, record, recorded: boolean|null, reason?: string}>, exitCode: 0|1}>` — `recorded` is `null` on a dry run
  - `formatTable(rows) => string` — markdown table

- [ ] **Step 1: Write the failing tests**

```js
// services/platform-collector/test/collect.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collect, formatTable } from '../src/collect.js';

const MANIFESTS = [
  { platform: 'alpha', health_url: 'https://a.test/health', token_env: 'A_TOKEN', timeout_ms: 1000 },
  { platform: 'beta', health_url: 'https://b.test/health', token_env: 'B_TOKEN', timeout_ms: 1000 },
];
const ENV = { A_TOKEN: 'a', B_TOKEN: 'b' };
const CFG = { enabled: true, url: 'https://memory.test', token: 'tok' };
const NOW = () => new Date('2026-10-16T19:17:42.000Z');
const noSleep = async () => {};

const healthy = () => ({ ok: true, status: 200, json: async () => ({ status: 'healthy', checks: {} }) });
const httpStatus = (status) => () => ({ ok: false, status });

// Routes platform URLs to handlers and Memory writes to a recorder.
function world({ platforms, memoryStatus = () => 201 }) {
  const writes = [];
  let memoryCalls = 0;
  const fetchImpl = async (url, options = {}) => {
    const u = String(url);
    if (u.endsWith('/api/intelligence/events')) {
      memoryCalls += 1;
      const record = JSON.parse(options.body);
      writes.push(record);
      const status = memoryStatus(record);
      return { ok: status >= 200 && status < 300, status, json: async () => ({}) };
    }
    const handler = platforms[u];
    if (!handler) throw new Error(`unexpected fetch ${u}`);
    return handler();
  };
  return { fetchImpl, writes, memoryCalls: () => memoryCalls };
}

const URLS = { a: 'https://a.test/health', b: 'https://b.test/health' };

test('every platform is fetched and recorded; exit 0', async () => {
  const w = world({ platforms: { [URLS.a]: healthy, [URLS.b]: healthy } });
  const { rows, exitCode } = await collect({ manifests: MANIFESTS, cfg: CFG, fetchImpl: w.fetchImpl, env: ENV, now: NOW, sleep: noSleep });
  assert.equal(exitCode, 0);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.recorded === true));
  assert.deepEqual(w.writes.map((r) => r.subject_id).sort(), ['alpha', 'beta']);
});

test('a down platform is recorded as data and keeps the run green', async () => {
  const w = world({ platforms: { [URLS.a]: healthy, [URLS.b]: httpStatus(503) } });
  const { rows, exitCode } = await collect({ manifests: MANIFESTS, cfg: CFG, fetchImpl: w.fetchImpl, env: ENV, now: NOW, sleep: noSleep });
  assert.equal(exitCode, 0);
  const beta = w.writes.find((r) => r.subject_id === 'beta');
  assert.equal(beta.signature, 'failure:maintenance');
  assert.equal(rows.find((row) => row.manifest.platform === 'beta').recorded, true);
});

test('an unset token is recorded as a config failure, not skipped', async () => {
  const w = world({ platforms: { [URLS.a]: healthy, [URLS.b]: healthy } });
  const { exitCode } = await collect({ manifests: MANIFESTS, cfg: CFG, fetchImpl: w.fetchImpl, env: { A_TOKEN: 'a' }, now: NOW, sleep: noSleep });
  assert.equal(exitCode, 0);
  assert.equal(w.writes.find((r) => r.subject_id === 'beta').signature, 'failure:config');
});

test('one platform failing to record turns the run red but the others are still recorded', async () => {
  const w = world({
    platforms: { [URLS.a]: healthy, [URLS.b]: healthy },
    memoryStatus: (record) => (record.subject_id === 'beta' ? 500 : 201),
  });
  const { rows, exitCode } = await collect({ manifests: MANIFESTS, cfg: CFG, fetchImpl: w.fetchImpl, env: ENV, now: NOW, sleep: noSleep });
  assert.equal(exitCode, 1);
  assert.equal(rows.find((row) => row.manifest.platform === 'alpha').recorded, true);
  const beta = rows.find((row) => row.manifest.platform === 'beta');
  assert.equal(beta.recorded, false);
  assert.match(beta.reason, /HTTP 500/);
});

test('Dot.Memory unconfigured turns a real run red and makes no write', async () => {
  const w = world({ platforms: { [URLS.a]: healthy, [URLS.b]: healthy } });
  const { rows, exitCode } = await collect({ manifests: MANIFESTS, cfg: { enabled: false }, fetchImpl: w.fetchImpl, env: ENV, now: NOW, sleep: noSleep });
  assert.equal(exitCode, 1);
  assert.ok(rows.every((row) => row.recorded === false));
  assert.equal(w.memoryCalls(), 0);
});

test('a dry run fetches but never writes, and stays green even with Memory unconfigured', async () => {
  const w = world({ platforms: { [URLS.a]: healthy, [URLS.b]: healthy } });
  const { rows, exitCode } = await collect({ manifests: MANIFESTS, cfg: { enabled: false }, fetchImpl: w.fetchImpl, env: ENV, now: NOW, sleep: noSleep, dryRun: true });
  assert.equal(exitCode, 0);
  assert.ok(rows.every((row) => row.recorded === null));
  assert.equal(w.memoryCalls(), 0);
  assert.ok(rows.every((row) => row.record.event_id.startsWith('collect-')));
});

test('formatTable renders one row per platform with its outcome', () => {
  const rows = [
    { manifest: { platform: 'alpha' }, result: { reachable: true, status: 'healthy' }, recorded: true },
    { manifest: { platform: 'beta' }, result: { reachable: false, kind: 'access' }, recorded: false },
    { manifest: { platform: 'gamma' }, result: { reachable: true, status: 'warning' }, recorded: null },
  ];
  assert.equal(formatTable(rows), [
    '| platform | reachable | status | kind | recorded |',
    '|---|---|---|---|---|',
    '| alpha | yes | healthy | - | yes |',
    '| beta | no | - | access | NO |',
    '| gamma | yes | warning | - | dry-run |',
  ].join('\n'));
});

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const run = (args, env = {}) => spawnSync(process.execPath, [CLI, ...args], {
  env: { PATH: process.env.PATH, ...env },
  encoding: 'utf8',
});

test('the CLI prints usage and exits 2 without the collect command or a manifest dir', () => {
  const noArgs = run([]);
  assert.equal(noArgs.status, 2);
  assert.match(noArgs.stderr, /usage: platform-collector collect/);
  assert.equal(run(['collect']).status, 2);
});

test('the CLI exits 2 when the manifest directory does not exist', () => {
  const result = run(['collect', '--manifest-dir', '/nonexistent-dir-for-test']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /manifest error/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/platform-collector && node --test test/collect.test.js`
Expected: FAIL — `Cannot find module '../src/collect.js'`

- [ ] **Step 3: Implement the collector**

```js
// services/platform-collector/src/collect.js
import { fetchHealth } from './fetch.js';
import { buildObservation } from './record.js';
import { writeObservation } from './memory.js';

/**
 * One collection run (design spec §4): fetch every platform concurrently,
 * record each result independently. A platform being down is data and keeps
 * the run green (alerting on it is Guardian's job); failing to RECORD turns
 * it red, because the point of this job is that Brain is never silently stale.
 *
 * @param {object} args
 * @param {object[]} args.manifests validated manifests (registry.js)
 * @param {{enabled: boolean, url?: string, token?: string}} args.cfg
 * @param {typeof fetch} [args.fetchImpl] used for both platforms and Dot.Memory
 * @param {Record<string, string|undefined>} [args.env]
 * @param {() => Date} [args.now]
 * @param {(ms: number) => Promise<void>} [args.sleep]
 * @param {boolean} [args.dryRun]
 */
export async function collect({ manifests, cfg, fetchImpl = fetch, env = process.env, now = () => new Date(), sleep, dryRun = false }) {
  const rows = await Promise.all(manifests.map(async (manifest) => {
    const result = await fetchHealth(manifest, { fetchImpl, env });
    const record = buildObservation(manifest, result, now());

    if (dryRun) {
      return { manifest, result, record, recorded: null };
    }

    const write = await writeObservation(cfg, record, { fetchImpl, sleep });
    return { manifest, result, record, recorded: write.ok, reason: write.ok ? null : write.reason };
  }));

  const unrecorded = rows.filter((row) => row.recorded === false).length;
  return { rows, exitCode: unrecorded > 0 ? 1 : 0 };
}

/** Markdown summary table, printed to stdout and to $GITHUB_STEP_SUMMARY. */
export function formatTable(rows) {
  const lines = ['| platform | reachable | status | kind | recorded |', '|---|---|---|---|---|'];
  for (const { manifest, result, recorded } of rows) {
    const recordedCell = recorded === null ? 'dry-run' : recorded ? 'yes' : 'NO';
    lines.push(
      `| ${manifest.platform} | ${result.reachable ? 'yes' : 'no'} | ${result.reachable ? result.status : '-'} | ${result.reachable ? '-' : result.kind} | ${recordedCell} |`,
    );
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Implement the CLI**

```js
#!/usr/bin/env node
// Usage: platform-collector collect --manifest-dir <dir> [--dry-run]
// Exit: 0 every observation recorded (platforms may be down -- that is data)
//       1 an observation could not be recorded, or Dot.Memory is not configured
//       2 usage error, invalid/missing manifests, or crash
import { appendFileSync } from 'node:fs';
import { loadManifests } from './registry.js';
import { memoryConfig } from './memory.js';
import { collect, formatTable } from './collect.js';

const [, , cmd, ...rest] = process.argv;
const USAGE = 'usage: platform-collector collect --manifest-dir <dir> [--dry-run]';

function flag(name) {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
}

const dir = flag('manifest-dir');
if (cmd !== 'collect' || !dir) {
  console.error(USAGE);
  process.exit(2);
}

const dryRun = rest.includes('--dry-run');

let manifests;
try {
  manifests = loadManifests(dir);
} catch (error) {
  console.error(`manifest error: ${error.message}`);
  process.exit(2);
}
if (manifests.length === 0) {
  console.error(`no manifests found in ${dir}`);
  process.exit(2);
}

const cfg = memoryConfig();
if (!dryRun && !cfg.enabled) {
  console.error('DOT_MEMORY_URL / DOT_MEMORY_TOKEN not set');
  process.exit(1);
}

const { rows, exitCode } = await collect({ manifests, cfg, dryRun });

const table = formatTable(rows);
console.log(table);
for (const row of rows) {
  if (!row.result.reachable) {
    console.log(`${row.manifest.platform}: ${row.result.kind} -- ${row.result.reason}`);
  }
  if (row.recorded === false) {
    console.error(`${row.manifest.platform}: not recorded -- ${row.reason}`);
  }
}

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Platform collection\n\n${table}\n`);
}

process.exit(exitCode);
```

- [ ] **Step 5: Run the whole suite to verify it passes**

Run: `cd services/platform-collector && npm test`
Expected: PASS (registry 15 + fetch 10 + record 11 + memory 9 + collect 9 = 54 tests, 0 failures)

- [ ] **Step 6: Commit**

```bash
git add services/platform-collector/src/collect.js services/platform-collector/src/cli.js services/platform-collector/test/collect.test.js
git commit -m "feat(platform-collector): add the collector, summary table, and CLI"
```

---

### Task 6: Enrollment, workflow, and CI registration

**Files:**
- Create: `platforms/collector/dot-mines.json`
- Create: `platforms/collector/blupin.json`
- Create: `.github/workflows/platform-collector.yml`
- Modify: `.github/workflows/tests.yml` (matrix + `covered=` string)
- Test: `services/platform-collector/test/enrollment.test.js`

**Interfaces:**
- Consumes: `loadManifests` (Task 1) and the CLI (Task 5)
- Produces: the two day-one manifests; the hourly workflow; CI coverage for the service

- [ ] **Step 1: Write the failing tests**

```js
// services/platform-collector/test/enrollment.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadManifests } from '../src/registry.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MANIFEST_DIR = `${ROOT}platforms/collector`;
const WORKFLOW = readFileSync(`${ROOT}.github/workflows/platform-collector.yml`, 'utf8');
const TESTS_WORKFLOW = readFileSync(`${ROOT}.github/workflows/tests.yml`, 'utf8');
const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

test('day-one enrollment is dot-mines and blupin, and every committed manifest is valid', () => {
  const manifests = loadManifests(MANIFEST_DIR);
  assert.deepEqual(manifests.map((m) => m.platform).sort(), ['blupin', 'dot-mines']);
  const mines = manifests.find((m) => m.platform === 'dot-mines');
  assert.equal(mines.health_url, 'https://mines.infodot.co.za/guardian/health');
  assert.equal(mines.token_env, 'DOT_MINES_GUARDIAN_TOKEN');
  const blupin = manifests.find((m) => m.platform === 'blupin');
  assert.equal(blupin.health_url, 'https://memory.infodot.co.za/api/guardian/blupin');
  assert.equal(blupin.token_env, 'DOT_MEMORY_TOKEN');
});

test('the workflow passes every enrolled manifest token_env to the job', () => {
  for (const manifest of loadManifests(MANIFEST_DIR)) {
    assert.ok(
      WORKFLOW.includes(`${manifest.token_env}: \${{ secrets.${manifest.token_env} }}`),
      `${manifest.token_env} (${manifest.platform}) is enrolled but never passed to the workflow`,
    );
  }
});

test('the workflow runs hourly at minute 17, never overlaps itself, and cannot write to the repo', () => {
  assert.ok(WORKFLOW.includes("cron: '17 * * * *'"));
  assert.ok(WORKFLOW.includes('cancel-in-progress: false'));
  assert.ok(WORKFLOW.includes('contents: read'));
});

test('the CI matrix and coverage check both include this service', () => {
  assert.ok(TESTS_WORKFLOW.includes('          - platform-collector\n'), 'missing from the matrix');
  const covered = TESTS_WORKFLOW.match(/covered="([^"]*)"/)[1].split(/\s+/);
  assert.ok(covered.includes('platform-collector'), 'missing from the covered list');
});

test('a dry run against the committed manifests makes no network call when no tokens are set', () => {
  const result = spawnSync(process.execPath, [CLI, 'collect', '--manifest-dir', MANIFEST_DIR, '--dry-run'], {
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dot-mines/);
  assert.match(result.stdout, /blupin/);
  assert.match(result.stdout, /config/);
});

test('a real run without Dot.Memory configured exits 1 before any request', () => {
  const result = spawnSync(process.execPath, [CLI, 'collect', '--manifest-dir', MANIFEST_DIR], {
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DOT_MEMORY_URL/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/platform-collector && node --test test/enrollment.test.js`
Expected: FAIL — `ENOENT` reading `platform-collector.yml` / manifest directory

- [ ] **Step 3: Create the two manifests**

`platforms/collector/dot-mines.json`:

```json
{
  "platform": "dot-mines",
  "health_url": "https://mines.infodot.co.za/guardian/health",
  "token_env": "DOT_MINES_GUARDIAN_TOKEN"
}
```

`platforms/collector/blupin.json`:

```json
{
  "platform": "blupin",
  "health_url": "https://memory.infodot.co.za/api/guardian/blupin",
  "token_env": "DOT_MEMORY_TOKEN"
}
```

- [ ] **Step 4: Create the workflow**

`.github/workflows/platform-collector.yml`:

```yaml
name: Platform Collector

# Hourly: fetch every platform enrolled in platforms/collector/ and record one
# observation per platform to Dot.Memory so Brain's picture of the live
# platforms is never stale. Runs from Dot.Brain's own Actions deliberately --
# NOT the shared cPanel crontab (F-INFRA-2026-001). See
# services/platform-collector/README.md and ADR-0019.
#
# Enrolling a platform = a manifest in platforms/collector/, a repository
# secret, and one env line below (Actions cannot pass "whatever secrets the
# manifests name" without exposing every secret). A test in
# services/platform-collector fails CI if a manifest's token_env is missing
# from this file.
#
# GitHub's cron is best-effort: "hourly" means roughly hourly. event_ids embed
# the UTC hour, so a late or duplicate run is harmless; a skipped hour is a gap.
on:
  schedule:
    - cron: '17 * * * *'
  workflow_dispatch:
    inputs:
      dry_run:
        description: Fetch and print only; record nothing
        type: boolean
        default: false

concurrency:
  group: platform-collector
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  collect:
    name: collect platform state
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Collect
        working-directory: services/platform-collector
        env:
          DOT_MEMORY_URL: https://memory.infodot.co.za
          DOT_MEMORY_TOKEN: ${{ secrets.DOT_MEMORY_TOKEN }}
          DOT_MINES_GUARDIAN_TOKEN: ${{ secrets.DOT_MINES_GUARDIAN_TOKEN }}
          DRY_RUN: ${{ inputs.dry_run }}
        run: |
          args=""
          if [ "$DRY_RUN" = "true" ]; then args="--dry-run"; fi
          node src/cli.js collect --manifest-dir ../../platforms/collector $args
```

- [ ] **Step 5: Register the service in CI**

In `.github/workflows/tests.yml`, add `platform-collector` as the last matrix entry:

```yaml
          - revenue-reader
          - revenue-intelligence
          - platform-collector
```

and append it to the `covered=` string on the coverage-check line:

```bash
          covered="guardian intelligence autonomy-score market-research intervention-log guardian-trigger blupin-context insight-delivery revenue-reader revenue-intelligence platform-collector"
```

- [ ] **Step 6: Run the whole suite to verify it passes**

Run: `cd services/platform-collector && npm test`
Expected: PASS (54 + 6 = 60 tests, 0 failures)

- [ ] **Step 7: Commit**

```bash
git add platforms/collector .github/workflows/platform-collector.yml .github/workflows/tests.yml services/platform-collector/test/enrollment.test.js
git commit -m "feat(platform-collector): enroll dot-mines and blupin, add the hourly workflow, register in CI"
```

---

### Task 7: ADR, docs, and README

**Files:**
- Create: `adr/ADR-0019-hourly-platform-collection.md`
- Create: `services/platform-collector/README.md`
- Modify: `brain.architecture.md` (version, diagram, component row, change log)
- Modify: `brain.security.md` (token-audit sentence, line 73)

- [ ] **Step 1: Write ADR-0019**

`adr/ADR-0019-hourly-platform-collection.md`:

```markdown
---
title: ADR-0019 — Hourly Platform Collection from Dot.Brain's GitHub Actions
version: 1.0.0
status: active
owners: [Chief Architect]
last-review: 2026-10-16
---

# ADR-0019 — Hourly Platform Collection from Dot.Brain's GitHub Actions

Purpose: record the decision to give Dot.Brain a recurring, queryable record of each live platform's state — one observation per platform per hour in Dot.Memory — and the decisions about where it runs and what it reuses.

> **Related documents:** [docs/superpowers/specs/2026-10-16-hourly-platform-collection-design.md](../docs/superpowers/specs/2026-10-16-hourly-platform-collection-design.md) — the full design · [ADR-0014-dot-guardian-architecture.md](ADR-0014-dot-guardian-architecture.md) — the contract and trust model this reuses · [ADR-0015-three-platform-intelligence-loop.md](ADR-0015-three-platform-intelligence-loop.md) — where the observations are recorded · [ADR-0016-health-failure-classification.md](ADR-0016-health-failure-classification.md) — the failure vocabulary · [../brain.architecture.md](../brain.architecture.md) · [../services/platform-collector](../services/platform-collector/README.md) — reference implementation.

---

## Status

Accepted — 2026-10-16

## Context

Dot.Brain should always know the current state of the live platforms. Today it has almost no recurring feed: Guardian (ADR-0014) polls every 5 minutes but exists to detect and remediate incidents, keeps only a local cache-backed store, and has two platforms enrolled; Revenue Reader (ADR-0018) has none; the DKP publish/subscribe gateway is not a running service. The deployed apps share one cPanel crontab, which three simultaneous deploys wiped on 2026-10-16 (F-INFRA-2026-001); Dot.Brain is not hosted there.

## Decision

1. **Run from Dot.Brain's own GitHub Actions, not the shared cPanel crontab.** The Actions scheduler is Brain's established one (`guardian-cron.yml`, `blupin-context.yml`) and sits outside the single shared file that failed.
2. **Reuse `dot-guardian/v1`; introduce no new contract.** The health document already carries a status plus per-check `metrics`; a platform that wants to report usage numbers puts them there. Dot.Mines is covered with zero platform changes.
3. **A separate service, not a Guardian mode.** Guardian can deploy and roll back platforms; passive collection must not inherit that authority, and Guardian's manifests require repo and deploy configuration a collection-only platform has no reason to declare.
4. **Record to Dot.Memory's intelligence events endpoint**, one idempotent observation per platform per UTC hour (`event_id = collect-<platform>-<yyyymmddhh>`), read back through Memory's existing `context` endpoint.
5. **Failure semantics follow the purpose.** A platform being down is recorded as data and keeps the run green (alerting is Guardian's job); inability to record turns the run red, because silent staleness is the failure this job exists to prevent. An unset token is recorded as `config`, never skipped.
6. **Reuse existing tokens.** `DOT_MINES_GUARDIAN_TOKEN` and `DOT_MEMORY_TOKEN` already exist as repository secrets; the collector adds a consumer, not a credential.

## Consequences

- No new trust boundary: an authenticated, Brain-initiated read of operational signals, exactly what ADR-0014 established; no raw business data is read or stored.
- Enrollment is a manifest, a repository secret, and one workflow `env:` line — not one file. GitHub Actions cannot pass "whichever secrets the manifests name" without exposing all of them; a test fails CI if a manifest's `token_env` is missing from the workflow.
- GitHub's cron is best-effort, so "hourly" means roughly hourly; late and duplicate runs are harmless by construction, a skipped hour is a gap.
- Other platforms enroll later by adding a manifest plus a `dot-guardian/v1` endpoint, each as its own PR in that platform's repository.

## Alternatives considered

- **A cPanel crontab line.** Rejected: Brain is not hosted there, and that crontab is a single shared file with a demonstrated wipe-everything failure mode.
- **An hourly mode inside Guardian.** Rejected: widens the blast radius of a service that can deploy, and couples collection-only platforms to remediation configuration.
- **A new `dot-usage/v1` contract.** Rejected as premature: nothing yet needs more than status plus metrics, and no platform other than Dot.Mines can serve any endpoint today.

---

## Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-10-16 | Brainstorming session | Initial decision record. |

## Open questions

- Who watches the collector? Nothing yet notices if the schedule is disabled or a secret expires; a Guardian check on the age of the latest `platform` observation in Memory (≤ 2 h) is the natural fit, once the collector exists to be watched.
- Retention: Dot.Memory has no pruning, and 24 rows per platform per day grows without bound. Fine at two platforms, worth a policy before ten.
- Whether Brain needs a shared cross-platform vocabulary for usage `metrics` keys, deferred until more than one platform reports usage.
```

- [ ] **Step 2: Write the service README**

`services/platform-collector/README.md`:

````markdown
# Dot.Brain — Platform Collector

Hourly collector for the live platforms (design spec:
[docs/superpowers/specs/2026-10-16-hourly-platform-collection-design.md](../../docs/superpowers/specs/2026-10-16-hourly-platform-collection-design.md),
ADR: [ADR-0019](../../adr/ADR-0019-hourly-platform-collection.md)).

Once an hour, [`.github/workflows/platform-collector.yml`](../../.github/workflows/platform-collector.yml)
fetches each enrolled platform's `dot-guardian/v1` health document and records
one observation per platform to Dot.Memory (`POST /api/intelligence/events`),
so Brain's picture of the live platforms is never stale. It runs from
Dot.Brain's own GitHub Actions on purpose — not the shared cPanel crontab.

It **records only**. It never remediates, opens incidents, or deploys — that is
[Guardian](../guardian/README.md).

## What gets recorded

One record per platform per UTC hour. `event_id` is
`collect-<platform>-<yyyymmddhh>`, so a late or duplicate run in the same hour
updates the existing row. A platform that is down is recorded as data
(`signature: failure:<kind>`, kinds per ADR-0016); a reachable one as
`status:<healthy|warning|critical|unknown>` with a compacted copy of its
checks and their `metrics`. Read the series back with Dot.Memory's
`GET /api/intelligence/context?subject_type=platform&subject_id=<platform>`.

## Enrolled platforms

| Platform | Endpoint | Token secret |
|---|---|---|
| `dot-mines` | `https://mines.infodot.co.za/guardian/health` | `DOT_MINES_GUARDIAN_TOKEN` |
| `blupin` | `https://memory.infodot.co.za/api/guardian/blupin` | `DOT_MEMORY_TOKEN` |

## Enrolling another platform

1. The platform serves an authenticated `GET` returning a `dot-guardian/v1`
   document (see [Guardian's README](../guardian/README.md#the-platform-contract-dot-guardianv1)).
   Usage numbers go in a check's `metrics`.
2. Add `platforms/collector/<platform>.json`:

   ```json
   {
     "platform": "dot-central",
     "health_url": "https://central.infodot.co.za/guardian/health",
     "token_env": "DOT_CENTRAL_GUARDIAN_TOKEN"
   }
   ```

   `health_url` must be `https://`; `timeout_ms` (default 15000) is optional;
   unrecognized keys are rejected.
3. Add the token as a Dot.Brain repository secret, **and** one line to the
   workflow's `env:` block. GitHub Actions cannot pass "whichever secrets the
   manifests name" without exposing every secret, so this step is manual — a
   test fails CI if a manifest's `token_env` is missing from the workflow.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | every observation was recorded (platforms may themselves be down) |
| `1` | an observation could not be recorded after retries, or Dot.Memory is not configured |
| `2` | usage error, invalid or missing manifests, or a crash |

A platform being down keeps the run green; being unable to record turns it red.

## Usage

```bash
# fetch and print only
node src/cli.js collect --manifest-dir ../../platforms/collector --dry-run

# fetch and record (needs DOT_MEMORY_URL, DOT_MEMORY_TOKEN, and each token_env)
node src/cli.js collect --manifest-dir ../../platforms/collector
```

You can also run the workflow by hand from the Actions tab (`dry_run` input available).

## Tests

```bash
npm test
```
````

- [ ] **Step 3: Update `brain.architecture.md`**

Make these edits.

(a) Front matter: change `version: 1.0.3` to `version: 1.0.4` and `last-review: 2026-09-23` to `last-review: 2026-10-16`.

(b) §2 diagram: in the `P` (Platform Edge) subgraph, after the `REVEP[...]` node line, add:

```
        HEALTHEP[dot-guardian/v1 endpoint<br/>platform-owned, opt-in via manifest]
```

In the `L1` (Ingestion & Validation) subgraph, after the `VAL[...]` line, add:

```
        COLLECT[Platform Collector<br/>hourly pull, records to Dot.Memory]
```

After the line `REVEP -->|signals, dot-revenue/v1| REVREAD`, add:

```
    COLLECT -->|hourly pull, scoped token, ADR-0019| HEALTHEP
    HEALTHEP -->|health + metrics, dot-guardian/v1| COLLECT
    COLLECT -->|one observation per platform per hour| MEM
```

(c) §3 component table: after the Revenue Intelligence row (before the `Query & Explanation API` row), add:

```
| Platform Collector | Hourly: fetch each enrolled platform's dot-guardian/v1 health document under a scoped token and record one observation per platform to Dot.Memory; classify every failure; record only — never remediate (that is Guardian) | [ADR-0019](adr/ADR-0019-hourly-platform-collection.md), [docs/superpowers/specs/2026-10-16-hourly-platform-collection-design.md](docs/superpowers/specs/2026-10-16-hourly-platform-collection-design.md) | Architecture, reference implementation `services/platform-collector` |
```

(d) Change log: after the `1.0.3` row, add:

```
| 1.0.4 | 2026-10-16 | Hourly platform collection | §2/§3: added the Platform Collector (ADR-0019) — a Layer 1 node with an hourly Brain-initiated pull of platform-owned `dot-guardian/v1` endpoints (new `HEALTHEP` node) and a write to Memory. It reuses the contract and trust model of Guardian (ADR-0014), so §6's inbound statement needs no change. |
```

- [ ] **Step 4: Update `brain.security.md`**

At the end of line 73 (the bullet beginning `- Brain-internal keys (agent credentials, PR tokens): 90-day rotation`), append this sentence:

```
 The Platform Collector ([ADR-0019](adr/ADR-0019-hourly-platform-collection.md)) deliberately reuses Guardian's existing health-check token (`DOT_MINES_GUARDIAN_TOKEN`) and the Memory token for the same endpoints rather than minting new ones — it adds a consumer to the audit, not a credential.
```

- [ ] **Step 5: Verify docs and the full suite**

Run: `grep -c "COLLECT\|HEALTHEP" brain.architecture.md` — Expected: `6` or more matching lines
Run: `grep -n "^version:\|^last-review:" brain.architecture.md` — Expected: `version: 1.0.4` and `last-review: 2026-10-16`
Run: `cd services/platform-collector && npm test` — Expected: PASS (60 tests)
Run: `for s in revenue-reader revenue-intelligence guardian; do (cd services/$s && npm test 2>&1 | grep -E "^ℹ (pass|fail)"); done` — Expected: only `fail 0` lines (no sibling regressions)

- [ ] **Step 6: Commit**

```bash
git add adr/ADR-0019-hourly-platform-collection.md services/platform-collector/README.md brain.architecture.md brain.security.md
git commit -m "docs: add ADR-0019, the collector README, and architecture/security updates"
```
