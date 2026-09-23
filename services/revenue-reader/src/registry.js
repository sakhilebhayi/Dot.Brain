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
