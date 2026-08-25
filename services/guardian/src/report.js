import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { listEscalations, listIncidents } from './store.js';

/**
 * Aggregate guardian state into the dashboard's numbers.
 */
export function summarize(store, now = new Date()) {
  const incidents = listIncidents(store);
  const escalations = listEscalations(store);
  const deployments = store.prepare('SELECT * FROM deployments ORDER BY id DESC').all();
  const breakers = store.prepare('SELECT * FROM breaker').all();

  const active = incidents.filter((incident) => ['open', 'remediating'].includes(incident.status));
  const resolved = incidents.filter((incident) => incident.status === 'resolved');
  const autoFixed = resolved.filter((incident) => incident.attempts > 0);
  const attempted = incidents.filter((incident) => incident.attempts > 0);

  const mttrMinutes = resolved.length === 0 ? null : Math.round(
    resolved.reduce((sum, incident) => {
      const opened = Date.parse(incident.first_seen);
      const closed = Date.parse(incident.resolved_at ?? incident.last_seen);
      return sum + Math.max(0, closed - opened);
    }, 0) / resolved.length / 60000,
  );

  const signatureCounts = {};
  for (const incident of incidents) {
    signatureCounts[incident.signature] = (signatureCounts[incident.signature] ?? 0) + 1;
  }
  const topSignatures = Object.entries(signatureCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  return {
    generated_at: now.toISOString(),
    totals: {
      incidents: incidents.length,
      active: active.length,
      resolved: resolved.length,
      escalated: incidents.filter((incident) => incident.status === 'escalated').length,
      auto_fixed: autoFixed.length,
      rollbacks: deployments.filter((deployment) => deployment.kind === 'rollback').length,
      deployments: deployments.length,
      escalations: escalations.length,
      success_rate: attempted.length > 0 ? Number((autoFixed.length / attempted.length).toFixed(2)) : null,
      mttr_minutes: mttrMinutes,
    },
    active,
    recent: incidents.slice(0, 25),
    breakers,
    top_signatures: topSignatures,
    recent_deployments: deployments.slice(0, 10),
    recent_escalations: escalations.slice(0, 10),
  };
}

const STATUS_COLORS = {
  open: '#c0392b',
  remediating: '#d68910',
  resolved: '#1e8449',
  escalated: '#7d3c98',
  rolled_back: '#b9770e',
};

/**
 * Render the guardian dashboard as one self-contained HTML file.
 */
export function renderHtml(summary) {
  const t = summary.totals;
  const stat = (label, value) => `<div class="stat"><div class="v">${value ?? '--'}</div><div class="l">${label}</div></div>`;
  const row = (incident) => `<tr>
    <td><code>${incident.incident_uid}</code></td>
    <td>${incident.platform}</td>
    <td><code>${incident.signature}</code></td>
    <td>${incident.severity}</td>
    <td><span class="badge" style="background:${STATUS_COLORS[incident.status] ?? '#555'}">${incident.status}</span></td>
    <td>${incident.attempts}</td>
    <td>${incident.first_seen}</td>
  </tr>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dot Guardian</title>
<style>
  :root { color-scheme: light; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; background: #f6f4ef; color: #1c1c1c; }
  h1 { margin: 0 0 .25rem; } .sub { color: #666; margin-bottom: 2rem; }
  .stats { display: flex; flex-wrap: wrap; gap: 1rem; margin-bottom: 2rem; }
  .stat { background: #fff; border: 1px solid #e3ded2; border-radius: 8px; padding: 1rem 1.5rem; min-width: 8rem; }
  .stat .v { font-size: 1.8rem; font-weight: 700; } .stat .l { color: #777; font-size: .85rem; }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #e3ded2; border-radius: 8px; overflow: hidden; }
  th, td { text-align: left; padding: .5rem .75rem; border-bottom: 1px solid #eee9dd; font-size: .9rem; }
  th { background: #efe9da; }
  .badge { color: #fff; border-radius: 4px; padding: .1rem .5rem; font-size: .8rem; }
  code { font-size: .85em; }
  section { margin-bottom: 2.5rem; overflow-x: auto; }
</style>
</head>
<body>
<h1>Dot Guardian</h1>
<div class="sub">Autonomous production guardian &middot; generated ${summary.generated_at}</div>
<div class="stats">
  ${stat('Active incidents', t.active)}
  ${stat('Resolved', t.resolved)}
  ${stat('Auto-fixed', t.auto_fixed)}
  ${stat('Escalated', t.escalated)}
  ${stat('Rollbacks', t.rollbacks)}
  ${stat('Deployments', t.deployments)}
  ${stat('Fix success rate', t.success_rate === null ? '--' : `${Math.round(t.success_rate * 100)}%`)}
  ${stat('MTTR (min)', t.mttr_minutes)}
</div>
<section>
<h2>Circuit breakers</h2>
${summary.breakers.length === 0 ? '<p>All closed.</p>' : `<table><tr><th>Platform</th><th>State</th><th>Consecutive failures</th><th>Opened</th><th>Reason</th></tr>${summary.breakers.map((breaker) => `<tr><td>${breaker.platform}</td><td>${breaker.state}</td><td>${breaker.consecutive_failures}</td><td>${breaker.opened_at ?? ''}</td><td>${breaker.reason ?? ''}</td></tr>`).join('')}</table>`}
</section>
<section>
<h2>Recent incidents</h2>
<table>
<tr><th>Incident</th><th>Platform</th><th>Signature</th><th>Severity</th><th>Status</th><th>Attempts</th><th>First seen</th></tr>
${summary.recent.map(row).join('\n')}
</table>
</section>
<section>
<h2>Most recurring signatures</h2>
<table>
<tr><th>Signature</th><th>Occurrences</th></tr>
${summary.top_signatures.map(([signature, count]) => `<tr><td><code>${signature}</code></td><td>${count}</td></tr>`).join('\n')}
</table>
</section>
<section>
<h2>Recent deployments</h2>
<table>
<tr><th>Platform</th><th>Kind</th><th>Workflow</th><th>Incident</th><th>Triggered</th></tr>
${summary.recent_deployments.map((deployment) => `<tr><td>${deployment.platform}</td><td>${deployment.kind}</td><td>${deployment.workflow ?? ''}</td><td><code>${deployment.incident_uid ?? ''}</code></td><td>${deployment.triggered_at}</td></tr>`).join('\n')}
</table>
</section>
<section>
<h2>Escalations &amp; recommendations</h2>
<table>
<tr><th>Platform</th><th>Incident</th><th>Reason</th><th>Issue</th><th>Raised</th></tr>
${summary.recent_escalations.map((escalationRow) => `<tr><td>${escalationRow.platform}</td><td><code>${escalationRow.incident_uid}</code></td><td>${escalationRow.reason}</td><td>${escalationRow.issue_url ? `<a href="${escalationRow.issue_url}">${escalationRow.issue_url}</a>` : ''}</td><td>${escalationRow.raised_at}</td></tr>`).join('\n')}
</table>
</section>
</body>
</html>`;
}

export function writeReport(store, outPath, now = new Date()) {
  const summary = summarize(store, now);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, renderHtml(summary));
  return summary;
}
