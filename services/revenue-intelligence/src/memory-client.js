/**
 * Dot.Memory client for revenue-intelligence-generated Insights. Same
 * shape as services/insight-delivery/src/memory-client.js -- every call
 * degrades honestly, an unreachable Memory is reported as {ok: false,
 * reason}, never treated as an empty or negative result.
 */

export function memoryConfig(env = process.env) {
  const url = env.DOT_MEMORY_URL;
  const token = env.DOT_MEMORY_TOKEN;

  return url && token
    ? { enabled: true, url: url.replace(/\/+$/, ''), token }
    : { enabled: false };
}

async function call(cfg, method, path, body, fetchImpl) {
  const response = await fetchImpl(`${cfg.url}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Dot.Memory answered HTTP ${response.status} for ${method} ${path}`);
  }

  return response.json();
}

export async function recordInsight(cfg, insight, fetchImpl = fetch) {
  return write(cfg, '/api/intelligence/insights', insight, fetchImpl);
}

export async function recordAction(cfg, envelope, fetchImpl = fetch) {
  return write(cfg, '/api/intelligence/actions', envelope, fetchImpl);
}

export async function recordOutcome(cfg, envelope, fetchImpl = fetch) {
  return write(cfg, '/api/intelligence/outcomes', envelope, fetchImpl);
}

async function write(cfg, path, envelope, fetchImpl) {
  if (!cfg.enabled) {
    return { ok: false, reason: 'Dot.Memory is not configured' };
  }

  try {
    await call(cfg, 'POST', path, envelope, fetchImpl);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}
