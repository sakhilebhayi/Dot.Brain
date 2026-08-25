import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store.js';
import { validateManifest } from '../src/registry.js';

export function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'guardian-test-'));
  return openStore(join(dir, 'guardian.sqlite'));
}

export function manifest(overrides = {}) {
  return validateManifest({
    platform: 'dot-mines',
    health_url: 'https://mines.test/guardian/health',
    token_env: 'TEST_GUARDIAN_TOKEN',
    repo: 'sakhilebhayi/Dot.Mines',
    default_branch: 'main',
    deploy: { workflow: 'deploy.yml', confirm_inputs: { confirm: 'deploy' } },
    autonomy_level: 3,
    verification: { polls: 2, interval_s: 0 },
    ...overrides,
  });
}

export function healthDoc(checks, status) {
  const statuses = Object.values(checks).map((check) => check.status);
  const worst = status
    ?? (statuses.includes('critical') ? 'critical' : statuses.includes('warning') ? 'warning' : statuses.includes('unknown') ? 'unknown' : 'healthy');
  return {
    platform: 'dot-mines',
    contract: 'dot-guardian/v1',
    generated_at: new Date().toISOString(),
    status: worst,
    checks: Object.fromEntries(Object.entries(checks).map(([key, check]) => [key, {
      message: '',
      metrics: {},
      ...check,
    }])),
  };
}

export function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

/**
 * Programmable fetch: routes[urlPrefix] is a function(url, options) or a
 * static response body. Records every call in .calls.
 */
export function fakeFetch(routes) {
  const impl = async (url, options = {}) => {
    impl.calls.push({ url: String(url), options });
    for (const [prefix, handler] of Object.entries(routes)) {
      if (String(url).startsWith(prefix)) {
        return typeof handler === 'function' ? handler(String(url), options) : jsonResponse(handler);
      }
    }
    throw new Error(`fakeFetch: no route for ${url}`);
  };
  impl.calls = [];
  return impl;
}

/**
 * Fake exec for gh/git: records every invocation; responders can override
 * stdout or throw per command signature.
 */
export function fakeRun(responders = []) {
  const impl = async (cmd, args) => {
    impl.calls.push({ cmd, args });
    for (const responder of responders) {
      if (responder.match(cmd, args)) {
        if (responder.error) {
          throw new Error(responder.error);
        }
        return { stdout: responder.stdout ?? '' };
      }
    }
    return { stdout: '' };
  };
  impl.calls = [];
  impl.find = (fragment) => impl.calls.filter((call) => `${call.cmd} ${call.args.join(' ')}`.includes(fragment));
  return impl;
}

export const noSleep = async () => {};
