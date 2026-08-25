import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED_KEYS = ['platform', 'health_url', 'token_env', 'repo', 'default_branch', 'deploy', 'autonomy_level'];

const DEFAULTS = {
  environment: 'production',
  poll_interval_s: 300,
  timeout_ms: 15000,
  max_fix_attempts: 2,
  max_deploys_per_6h: 3,
  protected_areas: [],
  verification: { polls: 5, interval_s: 60 },
};

/**
 * Validate one platform guardian manifest (platforms/guardian/<name>.json)
 * and fill defaults. Registry-driven by design: enrolling a new platform
 * is one manifest file, never an architecture change.
 */
export function validateManifest(raw) {
  for (const key of REQUIRED_KEYS) {
    if (raw[key] === undefined || raw[key] === null || raw[key] === '') {
      throw new Error(`Manifest for "${raw.platform ?? '?'}" is missing required key: ${key}`);
    }
  }
  if (!Number.isInteger(raw.autonomy_level) || raw.autonomy_level < 1 || raw.autonomy_level > 4) {
    throw new Error(`Manifest for "${raw.platform}" has invalid autonomy_level (must be integer 1-4).`);
  }
  if (typeof raw.deploy.workflow !== 'string' || raw.deploy.workflow === '') {
    throw new Error(`Manifest for "${raw.platform}" must declare deploy.workflow.`);
  }
  return {
    ...DEFAULTS,
    ...raw,
    verification: { ...DEFAULTS.verification, ...(raw.verification ?? {}) },
    deploy: { confirm_inputs: {}, ...raw.deploy },
  };
}

export function loadManifests(dir) {
  const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
  return files.map((name) => {
    const raw = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    try {
      return validateManifest(raw);
    } catch (error) {
      throw new Error(`${name}: ${error.message}`);
    }
  });
}
