import { readdirSync, readFileSync } from 'node:fs';
import { CLASSIFICATIONS } from './contract.js';

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

const ALLOWED_KEYS = [...REQUIRED_KEYS, ...Object.keys(DEFAULTS)];

function requirePositiveNumber(manifest, key) {
  if (typeof manifest[key] !== 'number' || !Number.isFinite(manifest[key]) || manifest[key] <= 0) {
    throw new Error(`${key} must be a positive number, got ${JSON.stringify(manifest[key])}`);
  }
}

/**
 * @param {object} raw
 * @returns {object} the manifest with every DEFAULTS key filled in
 */
export function validateManifest(raw) {
  // Non-string here (a typo'd sibling key, an object, a number) used to
  // pass this check -- `!raw?.[key]` only screens out falsy values -- and
  // then flow straight through to a "validated" manifest. platform, in
  // particular, ends up as an Insight's `scope`, which insight.schema.json
  // declares a string.
  const missing = REQUIRED_KEYS.filter((key) => typeof raw?.[key] !== 'string' || raw[key] === '');
  if (missing.length > 0) {
    throw new Error(`manifest missing required key(s): ${missing.join(', ')}`);
  }

  // A miscased or misspelled optional key (e.g. `Classification_Ceiling`)
  // used to be silently dropped, silently falling back to DEFAULTS --
  // discarding the operator's actual intent rather than failing loudly.
  const unknown = Object.keys(raw).filter((key) => !ALLOWED_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new Error(`manifest has unrecognized key(s): ${unknown.join(', ')}`);
  }

  const manifest = { ...DEFAULTS, ...raw };
  if (!CLASSIFICATIONS.includes(manifest.classification_ceiling)) {
    throw new Error(`classification_ceiling must be one of ${CLASSIFICATIONS.join(', ')}, got ${JSON.stringify(manifest.classification_ceiling)}`);
  }
  requirePositiveNumber(manifest, 'poll_interval_s');
  requirePositiveNumber(manifest, 'timeout_ms');
  // This capability reads financial data and authenticates with a bearer
  // token (§3) -- plaintext HTTP would send both over the wire in the
  // clear. No narrowly-reviewed exception exists yet, so this is a hard
  // requirement, not a warning.
  if (!manifest.signals_url.startsWith('https://')) {
    throw new Error(`signals_url must use https, got ${JSON.stringify(manifest.signals_url)}`);
  }
  return manifest;
}

/**
 * Loads and validates every manifest in a directory. One bad manifest --
 * whether unparseable JSON or a failed validateManifest -- fails loudly
 * with its filename rather than being silently skipped.
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
      try {
        const raw = JSON.parse(readFileImpl(`${dir}/${name}`, 'utf8'));
        return validateManifest(raw);
      } catch (error) {
        throw new Error(`${name}: ${error.message}`);
      }
    });
}
