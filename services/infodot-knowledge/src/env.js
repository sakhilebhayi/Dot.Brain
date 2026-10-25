// services/infodot-knowledge/src/env.js

export const REQUIRED_ENV = ['INFODOT_URL', 'KNOWLEDGE_SECRET_BRAIN', 'DOT_MEMORY_URL', 'DOT_MEMORY_TOKEN'];

/**
 * Fail closed: every variable must be set, and both URLs must be https (plain
 * http only for a loopback host, so tests and local runs work). The result
 * names the offending VARIABLES, never their values.
 *
 * @returns {{ok: true, cfg: {infodotUrl: string, secret: string, memoryUrl: string, memoryToken: string}} |
 *   {ok: false, missing: string[], invalid: string[]}}
 */
export function loadEnv(env = process.env) {
  const missing = REQUIRED_ENV.filter((name) => !env[name] || String(env[name]).trim() === '');
  const invalid = [];

  const url = (name) => {
    if (missing.includes(name)) return undefined;
    try {
      const u = new URL(env[name]);
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
      if (u.protocol === 'https:' || (u.protocol === 'http:' && loopback)) {
        return String(env[name]).replace(/\/+$/, '');
      }
    } catch { /* fall through */ }
    invalid.push(name);
    return undefined;
  };

  const infodotUrl = url('INFODOT_URL');
  const memoryUrl = url('DOT_MEMORY_URL');

  if (missing.length || invalid.length) {
    return { ok: false, missing, invalid };
  }

  return {
    ok: true,
    cfg: { infodotUrl, secret: env.KNOWLEDGE_SECRET_BRAIN, memoryUrl, memoryToken: env.DOT_MEMORY_TOKEN },
  };
}
