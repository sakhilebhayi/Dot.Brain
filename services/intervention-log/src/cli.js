#!/usr/bin/env node
import { openLog, record, listEntries, computeStreak } from './log.js';

function parseFlags(argv) {
  const flags = {};
  for (const arg of argv) {
    const match = arg.match(/^--([a-z-]+)=(.*)$/s);
    if (match) {
      const key = match[1].replace(/-/g, '_');
      flags[key] = match[2];
    }
  }
  return flags;
}

function requireFlags(flags, names) {
  const missing = names.filter((name) => flags[name] === undefined);
  if (missing.length > 0) {
    throw new Error(`Missing required flag(s): ${missing.map((n) => `--${n.replace(/_/g, '-')}`).join(', ')}`);
  }
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  const log = openLog(new URL('../data/intervention-log.sqlite', import.meta.url).pathname);

  if (command === 'log') {
    requireFlags(flags, [
      'entity', 'category', 'problem', 'trigger', 'root_cause',
      'why_automation_failed', 'recommended_solution', 'logged_by',
    ]);
    record(log, {
      entity: flags.entity,
      platform: flags.platform ?? null,
      category: flags.category,
      problem: flags.problem,
      trigger: flags.trigger,
      root_cause: flags.root_cause,
      why_automation_failed: flags.why_automation_failed,
      recommended_permanent_solution: flags.recommended_solution,
      decision_required: flags.decision_required ?? null,
      time_spent_minutes: flags.time_spent_minutes ? Number(flags.time_spent_minutes) : null,
      logged_by: flags.logged_by,
    });
    console.log(`Logged ${flags.category} intervention for ${flags.entity}.`);
    return;
  }

  if (command === 'list') {
    const rows = listEntries(log, { entity: flags.entity, since: flags.since });
    if (rows.length === 0) {
      console.log('No intervention log entries.');
      return;
    }
    for (const row of rows) {
      console.log(`[${row.occurred_at}] ${row.entity}${row.platform ? ` (${row.platform})` : ''} -- ${row.category} -- ${row.problem}`);
    }
    return;
  }

  if (command === 'streak') {
    const { currentStreakDays, longestStreakDays } = computeStreak(log, { entity: flags.entity });
    console.log(`Current streak: ${currentStreakDays} day(s)`);
    console.log(`Longest streak: ${longestStreakDays} day(s)`);
    return;
  }

  console.error('Usage:');
  console.error('  intervention-log log --entity=<name> [--platform=<name>] --category=<routine|strategic> \\');
  console.error('    --problem="<text>" --trigger="<text>" --root-cause="<text>" \\');
  console.error('    --why-automation-failed="<text>" --recommended-solution="<text>" \\');
  console.error('    [--decision-required="<text>"] [--time-spent-minutes=<n>] --logged-by=<session|owner>');
  console.error('  intervention-log list [--entity=<name>] [--since=<ISO date>]');
  console.error('  intervention-log streak [--entity=<name>]');
  process.exit(1);
}

try {
  main();
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
