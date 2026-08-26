/**
 * Dot.Brain's client for Dot.Memory (ADR-0015).
 *
 * Brain asks Memory what is known BEFORE deciding, rather than
 * rediscovering it. Every call degrades honestly: if Memory cannot be
 * reached, the caller is told the context is unavailable rather than
 * handed an empty pack that would read as "nothing has ever happened" --
 * that distinction decides whether a machine is allowed to act.
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

/**
 * "What do we know about this subject?" -- the evidence pack.
 */
export async function fetchContext(cfg, { subjectType, subjectId, signature, platform }, fetchImpl = fetch) {
  if (!cfg.enabled) {
    return { available: false, reason: 'Dot.Memory is not configured' };
  }

  const query = new URLSearchParams({ subject_type: subjectType, subject_id: subjectId });
  if (signature) query.set('signature', signature);
  if (platform) query.set('platform', platform);

  try {
    const payload = await call(cfg, 'GET', `/api/intelligence/context?${query}`, undefined, fetchImpl);
    return { available: true, ...(payload.data ?? {}) };
  } catch (error) {
    // Unreachable memory is NOT the same as an empty history.
    return { available: false, reason: error.message };
  }
}

export async function recordDecision(cfg, envelope, fetchImpl = fetch) {
  return write(cfg, '/api/intelligence/decisions', envelope, fetchImpl);
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
