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

/**
 * @param {object} raw
 * @returns {object} the manifest with every DEFAULTS key filled in
 */
export function validateManifest(raw) {
  const missing = REQUIRED_KEYS.filter((key) => !raw?.[key]);
  if (missing.length > 0) {
    throw new Error(`manifest missing required key(s): ${missing.join(', ')}`);
  }
  const manifest = { ...DEFAULTS, ...raw };
  if (!CLASSIFICATIONS.includes(manifest.classification_ceiling)) {
    throw new Error(`classification_ceiling must be one of ${CLASSIFICATIONS.join(', ')}, got ${JSON.stringify(manifest.classification_ceiling)}`);
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
