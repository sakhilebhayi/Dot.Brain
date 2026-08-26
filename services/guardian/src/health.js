const VALID_STATUSES = ['healthy', 'warning', 'critical', 'unknown'];

/**
 * Why a health fetch failed. Every one of these used to collapse into
 * "unreachable", which paged a human at sev1 saying the platform or its
 * database was down. Four such pages were raised against Dot.Mines that
 * were actually HTTP 403s from the host's edge firewall transiently
 * blocking the runner IP -- the app was up and answering the whole time.
 *
 *   unreachable    -- nothing answered: DNS, connection refused, timeout
 *   platform_error -- answered with 5xx: the app is failing
 *   maintenance    -- answered 503: almost always our own deploy
 *   access         -- answered 401/403: reached and refused, an access
 *                     problem, NOT an availability one
 *   config         -- 404, or no token: we are pointed at the wrong place
 *   contract       -- answered, but not with dot-guardian/v1
 */
export const FAILURE_KINDS = ['unreachable', 'platform_error', 'maintenance', 'access', 'config', 'contract'];

/**
 * Fetch one platform's dot-guardian/v1 health document.
 *
 * Never throws: every failure comes back as { reachable: false, kind,
 * reason } so the caller can tell "nothing answered" from "something
 * answered and said no".
 */
export async function fetchHealth(manifest, fetchImpl = fetch, env = process.env) {
  const token = env[manifest.token_env];
  if (!token) {
    return { reachable: false, kind: 'config', reason: `token env ${manifest.token_env} is not set` };
  }

  let response;
  try {
    response = await fetchImpl(manifest.health_url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(manifest.timeout_ms ?? 15000),
    });
  } catch (error) {
    return { reachable: false, kind: 'unreachable', reason: `fetch failed: ${error.message}` };
  }

  if (!response.ok) {
    return { reachable: false, kind: kindForStatus(response.status), reason: `HTTP ${response.status}` };
  }

  let doc;
  try {
    doc = await response.json();
  } catch {
    return { reachable: false, kind: 'contract', reason: 'response body was not JSON' };
  }

  if (typeof doc?.checks !== 'object' || doc.checks === null || !VALID_STATUSES.includes(doc?.status)) {
    return { reachable: false, kind: 'contract', reason: 'response did not match the dot-guardian/v1 contract' };
  }

  return {
    reachable: true,
    status: doc.status,
    generated_at: doc.generated_at ?? null,
    checks: doc.checks,
  };
}

/** A response arrived, so the question is only what it said. */
function kindForStatus(status) {
  if (status === 401 || status === 403) return 'access';
  if (status === 404) return 'config';
  if (status === 503) return 'maintenance';
  if (status >= 500) return 'platform_error';
  return 'access';
}

/**
 * How each failure kind is reported. Only the kinds where nothing answered,
 * or answered with a server error, are allowed to be `availability` -- that
 * is the check severityFor() escalates to sev1, so anything else landing
 * there pages a human about an outage that is not happening.
 */
const FAILURE_REPORTING = {
  unreachable: { check: 'availability', status: 'critical', gated: true, describe: (r) => `Nothing answered at the health endpoint: ${r}.` },
  platform_error: { check: 'availability', status: 'critical', gated: true, describe: (r) => `The platform answered with a server error (${r}).` },
  maintenance: { check: 'maintenance', status: 'warning', gated: true, describe: (r) => `The platform is in maintenance mode (${r}), which is what a deploy looks like.` },
  access: { check: 'access', status: 'warning', gated: false, describe: (r) => `The platform refused the guardian's credentials (${r}). It is reachable; this is an access problem, not an outage.` },
  config: { check: 'access', status: 'critical', gated: false, describe: (r) => `The guardian is misconfigured for this platform: ${r}.` },
  contract: { check: 'contract', status: 'warning', gated: false, describe: (r) => `The platform answered, but not with dot-guardian/v1: ${r}.` },
};

/**
 * Flatten a fetchHealth result into a uniform checks map. A failure becomes
 * a synthetic check so the rest of the pipeline needs no special case.
 *
 * `failureStreak` is how many consecutive polls have now failed, including
 * this one. A single failed poll is not an outage -- it is a blip, and on
 * shared hosting behind a WAF it is a fairly common one -- so the kinds
 * that would page at sev1 are held at `unknown` (which detect.js neither
 * opens nor closes on) until the streak reaches the threshold.
 */
export function normalizeChecks(healthResult, { failureStreak = Infinity, availabilityThreshold = 2 } = {}) {
  if (!healthResult.reachable) {
    const kind = healthResult.kind ?? 'unreachable';
    const reporting = FAILURE_REPORTING[kind] ?? FAILURE_REPORTING.unreachable;
    const confirmed = !reporting.gated || failureStreak >= availabilityThreshold;

    return {
      [reporting.check]: {
        status: confirmed ? reporting.status : 'unknown',
        message: confirmed
          ? reporting.describe(healthResult.reason)
          : `${reporting.describe(healthResult.reason)} Failure ${failureStreak} of ${availabilityThreshold} needed before this is treated as an incident.`,
        metrics: Number.isFinite(failureStreak)
          ? { failure_kind: kind, failure_streak: failureStreak }
          : { failure_kind: kind },
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
