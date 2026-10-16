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

const INVALID_URL = 'health_url must be a valid https URL with a host and no embedded credentials';

// The URL is never echoed in an error: it can carry credentials
// (https://user:pass@host), and these messages end up in public run logs.
function checkHealthUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(INVALID_URL);
  }
  if (url.protocol !== 'https:') {
    throw new Error('health_url must use https');
  }
  if (!url.hostname || url.username || url.password) {
    throw new Error(INVALID_URL);
  }
}

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
  checkHealthUrl(manifest.health_url);
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
  // Sorted, so the order of rows, writes and log lines does not depend on the
  // filesystem's directory order.
  const loaded = readDirImpl(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
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
