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

function minutes(ms) {
  if (!Number.isFinite(ms)) return 'an unknown time';
  const total = Math.round(ms / 60000);
  return total < 1 ? 'under a minute' : `${total} minute${total === 1 ? '' : 's'}`;
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
 * A single failed poll is not an outage -- it is a blip, and on shared
 * hosting behind a WAF a fairly common one -- so the kinds that would page
 * at sev1 are held at `unknown` (which detect.js neither opens nor closes
 * on) until the failure has PERSISTED.
 *
 * Persistence is measured in elapsed time, not polls. Counting polls sounds
 * equivalent and is not: guardian-cron is scheduled every 5 minutes and
 * GitHub throttles it to 20-40, so "two failures" silently meant anywhere
 * between 10 and 80 minutes of outage depending on how busy Actions was
 * that day. A duration means the same thing whatever the cadence does.
 *
 * Two failures are still required regardless -- one observation cannot
 * establish that anything lasted.
 */
export function normalizeChecks(healthResult, {
  failureStreak = Infinity,
  failureElapsedMs = Infinity,
  availabilityWindowMs = 600000,
} = {}) {
  if (!healthResult.reachable) {
    const kind = healthResult.kind ?? 'unreachable';
    const reporting = FAILURE_REPORTING[kind] ?? FAILURE_REPORTING.unreachable;
    const sustained = failureStreak >= 2 && failureElapsedMs >= availabilityWindowMs;
    const confirmed = !reporting.gated || sustained;

    return {
      [reporting.check]: {
        status: confirmed ? reporting.status : 'unknown',
        message: confirmed
          ? `${reporting.describe(healthResult.reason)} Sustained for ${minutes(failureElapsedMs)} across ${failureStreak} checks.`
          : `${reporting.describe(healthResult.reason)} Failing for ${minutes(failureElapsedMs)}; treated as an incident once it has persisted ${minutes(availabilityWindowMs)}.`,
        metrics: Number.isFinite(failureStreak)
          ? { failure_kind: kind, failure_streak: failureStreak, failure_elapsed_s: Math.round(failureElapsedMs / 1000) }
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
