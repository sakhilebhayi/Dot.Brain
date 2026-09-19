/**
 * Dot.Brain's client for Dot.Memory, for the outbound Insight path
 * (design spec §3-4). Mirrors services/intelligence/src/memory-client.js's
 * shape: every call degrades honestly -- an unreachable Memory is reported
 * as unavailable/not-ok, never as an empty or negative result.
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

export async function searchInsights(cfg, { domain, scope, platform } = {}, fetchImpl = fetch) {
  if (!cfg.enabled) {
    return { available: false, reason: 'Dot.Memory is not configured' };
  }

  const query = new URLSearchParams();
  if (domain) query.set('domain', domain);
  if (scope) query.set('scope', scope);
  if (platform) query.set('platform', platform);
  const qs = query.toString();

  try {
    const payload = await call(cfg, 'GET', `/api/intelligence/insights${qs ? `?${qs}` : ''}`, undefined, fetchImpl);
    return { available: true, items: payload.data?.items ?? [] };
  } catch (error) {
    return { available: false, reason: error.message };
  }
}

export async function getInsight(cfg, id, fetchImpl = fetch) {
  if (!cfg.enabled) {
    return { available: false, reason: 'Dot.Memory is not configured' };
  }

  try {
    const payload = await call(cfg, 'GET', `/api/intelligence/insights/${id}`, undefined, fetchImpl);
    return { available: true, item: payload.data };
  } catch (error) {
    return { available: false, reason: error.message };
  }
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
