/**
 * The runbook registry: the ONLY actions the guardian may take against a
 * platform autonomously. Every runbook maps to the platform's own GitHub
 * repo and CI/CD workflow -- there is no side channel into production.
 *
 * Novel code fixes are deliberately NOT a runbook: at every autonomy level
 * an unknown failure surfaces as a recommendation or escalation for a
 * human (or an explicitly-invoked coding agent) to write the patch, which
 * then becomes a recorded, validated fix Dot.Memory can recall next time.
 *
 * kind:
 *   workflow  -- re-run the platform's deploy workflow (fresh code checkout,
 *                config/route/view cache rebuild, queue:restart). Fixes the
 *                "stuck process serving stale state" family.
 *   revert_pr -- open (and at autonomy >= 3, merge + deploy) a PR that
 *                reverts the platform's most recent deployment commits.
 *   advisory  -- no automated action exists or should exist; the runbook
 *                carries the advice a human needs. Never auto-executed at
 *                any autonomy level (decide.js short-circuits to recommend,
 *                and remediate.js refuses it outright as defense in depth).
 */
const RUNBOOKS = {
  queue: {
    key: 'redeploy',
    kind: 'workflow',
    risk: 0.2,
    description: 'Re-run the deploy workflow: queue:restart + cache rebuild clears a stuck queue drain.',
  },
  integration_sync: {
    key: 'redeploy',
    kind: 'workflow',
    risk: 0.2,
    description: 'Re-run the deploy workflow: restarts workers and recaches config so scheduled syncs resume.',
  },
  telemetry_ingestion: {
    key: 'redeploy',
    kind: 'workflow',
    risk: 0.2,
    description: 'Re-run the deploy workflow: restarts the ingestion path end to end.',
  },
  production_freshness: {
    key: 'redeploy',
    kind: 'workflow',
    risk: 0.2,
    description: 'Re-run the deploy workflow: restarts sync + calculators that write production records.',
  },
  provider_data_freshness: {
    key: 'contact_provider',
    kind: 'advisory',
    risk: 0,
    description: 'The manufacturer feed has stalled while machines are working -- the platform, its sync, and its ingest pipeline are healthy. Check the provider portal or status page and raise it with the manufacturer if it persists; a redeploy cannot fix an upstream feed.',
  },
  error_rate: {
    key: 'rollback_last_deploy',
    kind: 'revert_pr',
    risk: 0.5,
    description: 'Revert the most recent deployment: an exception spike right after a deploy is usually the deploy.',
  },
  // scheduler: cron itself died -- no GitHub-reachable fix, needs the host.
  // database / cache / availability: infrastructure, not code. All null =>
  // recommend/escalate, never an autonomous action.
  scheduler: null,
  database: null,
  cache: null,
  availability: null,
};

export function forCheck(checkKey) {
  return RUNBOOKS[checkKey] ?? null;
}
