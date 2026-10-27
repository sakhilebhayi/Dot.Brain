// services/brand-engine/src/analyze/render.js
//
// Human-readable renderings of analysis, plan and verification documents.
// Fixed templates over the document's own fields: no clock, no environment,
// no wording the data did not supply, so the same document renders to the same
// bytes. Text that came from a check or a report is already bounded and
// scrubbed; here it is only escaped for Markdown.
const esc = (s) => String(s).replace(/([\\`*_{}[\]<>|])/g, '\\$1').replace(/\r?\n/g, ' ');
const code = (s) => `\`${String(s).replace(/`/g, "'")}\``;
const where = (loc) => (loc ? `${loc.file}${loc.line ? `:${loc.line}` : ''}` : '(no location)');

export function renderAnalysis(a) {
  const L = [];
  L.push('# Brand experience analysis');
  L.push('');
  L.push(`- Repository: ${a.input.repo ?? 'unknown'}; commit: ${a.input.commit ?? 'unknown'} (${a.input.commit_source})`);
  L.push(`- Scope: ${a.input.scope ?? 'the whole checkout'}`);
  L.push(`- Profile: ${a.profile.id}@${a.profile.version} (${a.profile.effective_status}); rubric ${a.rubric.id}@${a.rubric.version}`);
  L.push(`- Checks run: ${a.counts.checks}; evidence rows: ${a.counts.evidence}; findings: ${a.counts.findings} (${a.counts.by_severity.blocker} blocker, ${a.counts.by_severity.major} major, ${a.counts.by_severity.minor} minor, ${a.counts.by_severity.info} info)`);
  L.push(`- Not measured: ${a.counts.not_measured} rubric check(s); these count as zero in the score and are listed below.`);
  L.push('');
  L.push('## Findings');
  if (a.findings.length === 0) L.push('', 'None.');
  for (const f of a.findings) {
    L.push('', `- **${f.severity}** ${code(f.id)} ${esc(f.message)} (${esc(where(f.location))})`);
    if (f.fix_hint) L.push(`  - Fix: ${esc(f.fix_hint)}`);
  }
  L.push('', '## Evidence');
  if (a.evidence.length === 0) L.push('', 'None.');
  for (const e of a.evidence) L.push(`- ${code(e.check_id)} ${e.result} (${e.value}) from ${esc(e.origin)}${e.detail ? `: ${esc(e.detail)}` : ''}`);
  L.push('', '## Not measured');
  if (a.not_measured.length === 0) L.push('', 'Every automated rubric check has evidence.');
  for (const n of a.not_measured) L.push(`- ${code(n.check_id)}: ${n.reason.replace(/_/g, ' ')}${n.adapters ? ` (supply a report from: ${n.adapters.join(', ')})` : ''}`);
  if (a.conflicts.length) {
    L.push('', '## Conflicting sources');
    for (const c of a.conflicts) L.push(`- ${code(c.check_id)}: ${c.origins.map(esc).join(', ')}`);
  }
  L.push('', '## Reports');
  for (const r of a.reports.ingested) L.push(`- ingested ${code(r.file)} as ${r.adapter}`);
  for (const r of a.reports.skipped) L.push(`- skipped ${code(r.file)}: ${esc(r.reason)}`);
  for (const n of a.reports.notes) L.push(`- note: ${esc(n)}`);
  if (a.reports.ingested.length + a.reports.skipped.length + a.reports.notes.length === 0) L.push('', 'No reports were supplied.');
  if (a.coverage.skipped_total) L.push('', `${a.coverage.skipped_total} path(s) were not read (vendored, generated, oversized, binary or sensitive).`);
  L.push('', 'The score is produced by `brand-engine evidence assemble` then `brand-engine score`. This analysis measures nothing about how people feel.');
  return `${L.join('\n')}\n`;
}

export function renderPlan(p) {
  const L = [];
  L.push('# Brand experience plan');
  L.push('');
  L.push(`Source: ${p.source.repo ?? 'unknown repository'} at ${p.source.commit ?? 'unknown commit'}; profile ${p.source.profile.id}@${p.source.profile.version} (${p.source.profile.effective_status}); rubric ${p.source.rubric.id}@${p.source.rubric.version}.`);
  L.push('');
  L.push(`${p.counts.proposed} proposed task(s) (${p.counts.blockers} blocking), ${p.counts.needs_human} for human review, ${p.counts.withheld} withheld. ${p.note}`);
  L.push('');
  L.push('## Tasks, in order');
  if (p.tasks.length === 0) L.push('', 'No task is proposed.');
  for (const t of p.tasks) {
    L.push('', `### ${t.rank}. ${esc(t.title)}`, '');
    L.push(`- [ ] ${code(t.id)} | effort ${t.effort} | about ${t.expected_points} point(s) | risk ${t.risk.level}${t.blocker ? ' | BLOCKER' : ''}`);
    L.push(`- Why: ${esc(t.why.statement)}. Principle ${t.why.principle}${t.why.principle_title ? ` (${esc(t.why.principle_title)})` : ''}; profile ${esc(t.why.profile_ref)}${t.why.profile_standards.length ? ` (${t.why.profile_standards.map(esc).join(', ')})` : ''}.`);
    if (t.files.length) {
      L.push('- Where:');
      for (const f of t.files) L.push(`  - ${code(f.file)}${f.lines.length ? ` lines ${f.lines.join(', ')}` : ''}`);
    } else L.push('- Where: no file location was reported; see the findings.');
    for (const h of t.fix_hints) L.push(`- Fix: ${esc(h)}`);
    L.push(`- Done when: ${esc(t.acceptance.rule)} Re-check with ${code(t.acceptance.check_id)}.`);
    for (const n of t.risk.notes) L.push(`- Note: ${esc(n)}`);
  }
  if (p.needs_human.length) {
    L.push('', '## Needs human review (not proposed)', '');
    for (const t of p.needs_human) L.push(`- ${code(t.id)} ${esc(t.title)}: ${esc(t.needs_human_reason)}`);
  }
  if (p.withheld.length) {
    L.push('', '## Withheld: would conflict with a domain override (not proposed)', '');
    for (const t of p.withheld) L.push(`- ${code(t.id)} ${esc(t.title)}: ${esc(t.withheld.text)} Blocked by ${t.withheld.blocked_by.map(code).join(', ')}.`);
  }
  if (p.engine_issues.length) {
    L.push('', '## Engine issues (a check could not run; not a product task)', '');
    for (const e of p.engine_issues) L.push(`- ${code(e.check_id)}: ${esc(e.message)}`);
  }
  if (p.not_measured.length) {
    L.push('', '## Not measured', '');
    for (const n of p.not_measured) L.push(`- ${code(n.check_id)}: ${n.reason.replace(/_/g, ' ')}`);
  }
  L.push('', 'Accessibility, security, safety, regulation and functional correctness outrank every task above. The engine does not edit the product repository.');
  return `${L.join('\n')}\n`;
}

export function renderVerification(v) {
  const L = [];
  L.push('# Verification');
  L.push('');
  L.push(`Verdict: **${v.verdict}** (exit ${v.exit}).`);
  L.push('');
  for (const r of v.reasons) L.push(`- ${esc(r)}`);
  const section = (title, list, fmt) => {
    if (!list.length) return;
    L.push('', `## ${title}`, '');
    for (const f of list) L.push(fmt(f));
  };
  const fmtF = (f) => `- ${code(f.id)} ${esc(f.message)} (${esc(where(f.location))})`;
  section('Fixed', v.findings.fixed, fmtF);
  section('Still open', v.findings.still_open, fmtF);
  section('New (regressions)', v.findings.new, fmtF);
  section('Newly measured (not regressions)', v.findings.newly_measured, fmtF);
  section('Restated (same finding, different numbers)', v.findings.restated ?? [], (r) => `- ${code(r.before.id)} to ${code(r.after.id)}: ${esc(r.before.message)} became ${esc(r.after.message)}`);
  section('Cannot be verified', v.findings.unverifiable, (f) => `- ${code(f.id)} ${esc(f.message)}: ${esc(f.reason)}`);
  section('Checks', v.checks.filter((c) => c.status !== 'same'), (c) => `- ${code(c.check_id)} ${c.status.replace(/_/g, ' ')}${c.delta !== null ? ` (${c.before} to ${c.after})` : ''}`);
  section('Plan tasks', v.tasks, (t) => `- ${code(t.id)} ${t.outcome.replace(/_/g, ' ')}${t.claimed ? ' (claimed)' : ''}: acceptance ${t.acceptance} on ${code(t.check_id)}`);
  return `${L.join('\n')}\n`;
}
