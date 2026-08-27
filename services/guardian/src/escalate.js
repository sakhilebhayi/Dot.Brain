import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordEscalation } from './store.js';

/**
 * Human-facing output channel: GitHub issues on the platform's own repo.
 * Used both for escalations (guardian stopped and needs a human) and for
 * recommendations (autonomy level 2, or autonomy gates not met).
 */
export async function openGuardianIssue({ manifest, incident, run, title, body }) {
  const dir = mkdtempSync(join(tmpdir(), 'guardian-issue-'));
  const bodyFile = join(dir, 'body.md');
  writeFileSync(bodyFile, body);

  const result = await run('gh', [
    'issue', 'create',
    '-R', manifest.repo,
    '--title', title,
    '--body-file', bodyFile,
  ]);

  return (result.stdout ?? '').trim() || null;
}

export function issueBody({ incident, decision, recall, extraLines = [] }) {
  const detail = safeParse(incident.detail);
  return [
    `## Guardian incident \`${incident.incident_uid}\``,
    '',
    `| Field | Value |`,
    `| --- | --- |`,
    `| Platform | ${incident.platform} |`,
    `| Check | ${incident.check_key} |`,
    `| Signature | \`${incident.signature}\` |`,
    `| Severity | ${incident.severity} |`,
    `| First seen | ${incident.first_seen} |`,
    `| Attempts | ${incident.attempts} |`,
    '',
    '### Decision',
    '',
    `Action: **${decision.action}** (confidence ${decision.confidence}, risk ${decision.risk})`,
    '',
    ...decision.reasons.map((reason) => `- ${reason}`),
    '',
    decision.runbook
      ? `Proposed runbook: **${decision.runbook.key}** -- ${decision.runbook.description}`
      : 'No runbook matched this check; a human diagnosis is needed.',
    '',
    '### Dot.Memory recall',
    '',
    recall && recall.matches > 0
      ? `${recall.matches} prior incident(s) with this signature; ${recall.resolved ?? 0} resolved, ${recall.rolled_back ?? 0} rolled back (success rate ${recall.success_rate ?? 'n/a'}).`
      : 'No prior incidents with this signature.',
    '',
    '### Health excerpt',
    '',
    '```json',
    JSON.stringify(detail, null, 2),
    '```',
    ...extraLines,
    '',
    '---',
    '_Opened automatically by the Dot.Brain guardian._',
  ].join('\n');
}

export async function raise({ store, manifest, incident, decision, recall, run, reason, now = new Date() }) {
  const title = `[guardian] ${incident.severity} ${incident.signature} -- human needed`;
  const body = issueBody({
    incident,
    decision,
    recall,
    extraLines: ['', '### Why escalated', '', reason],
  });
  const issueUrl = await openGuardianIssue({ manifest, incident, run, title, body });
  recordEscalation(store, {
    incident_uid: incident.incident_uid,
    platform: incident.platform,
    reason,
    issue_url: issueUrl,
  }, now);
  return issueUrl;
}

export async function recommend({ store, manifest, incident, decision, recall, run, now = new Date() }) {
  const title = `[guardian] ${incident.severity} ${incident.signature} -- proposed remediation`;
  const body = issueBody({
    incident,
    decision,
    recall,
    extraLines: [
      '',
      '### Approval',
      '',
      decision.runbook
        ? (decision.runbook.kind === 'advisory'
          ? `${decision.runbook.description} Close this issue once the provider recovers.`
          : `To apply: re-run \`${manifest.deploy.workflow}\` on ${manifest.repo}, or close this issue if not appropriate.`)
        : 'Diagnose manually; the guardian has no safe automated action for this check.',
    ],
  });
  const issueUrl = await openGuardianIssue({ manifest, incident, run, title, body });
  recordEscalation(store, {
    incident_uid: incident.incident_uid,
    platform: incident.platform,
    reason: `recommendation: ${decision.runbook?.key ?? 'manual diagnosis'}`,
    issue_url: issueUrl,
  }, now);
  return issueUrl;
}

function safeParse(json) {
  try {
    return typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    return null;
  }
}
