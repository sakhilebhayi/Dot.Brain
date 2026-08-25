const VALID_STATUSES = ['healthy', 'warning', 'critical', 'unknown'];

/**
 * Fetch one platform's dot-guardian/v1 health document.
 *
 * Never throws: network failure, timeout, auth rejection, or a malformed
 * body all come back as { reachable: false, reason } -- detection turns
 * that into a critical `availability` incident, which is exactly what an
 * unreachable production app is.
 */
export async function fetchHealth(manifest, fetchImpl = fetch, env = process.env) {
  const token = env[manifest.token_env];
  if (!token) {
    return { reachable: false, reason: `token env ${manifest.token_env} is not set` };
  }

  let response;
  try {
    response = await fetchImpl(manifest.health_url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(manifest.timeout_ms ?? 15000),
    });
  } catch (error) {
    return { reachable: false, reason: `fetch failed: ${error.message}` };
  }

  if (!response.ok) {
    return { reachable: false, reason: `HTTP ${response.status}` };
  }

  let doc;
  try {
    doc = await response.json();
  } catch {
    return { reachable: false, reason: 'response body was not JSON' };
  }

  if (typeof doc?.checks !== 'object' || doc.checks === null || !VALID_STATUSES.includes(doc?.status)) {
    return { reachable: false, reason: 'response did not match the dot-guardian/v1 contract' };
  }

  return {
    reachable: true,
    status: doc.status,
    generated_at: doc.generated_at ?? null,
    checks: doc.checks,
  };
}

/**
 * Flatten a fetchHealth result into a uniform checks map. Unreachable
 * platforms become a synthetic critical `availability` check so the rest
 * of the pipeline needs no special case.
 */
export function normalizeChecks(healthResult) {
  if (!healthResult.reachable) {
    return {
      availability: {
        status: 'critical',
        message: `Platform health endpoint unreachable: ${healthResult.reason}`,
        metrics: {},
      },
    };
  }
  const normalized = {};
  for (const [key, check] of Object.entries(healthResult.checks)) {
    normalized[key] = {
      status: VALID_STATUSES.includes(check?.status) ? check.status : 'unknown',
      message: typeof check?.message === 'string' ? check.message : '',
      metrics: typeof check?.metrics === 'object' && check.metrics !== null ? check.metrics : {},
    };
  }
  return normalized;
}
