#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { scoreEntity, averageScore } from './score.js';

const CATEGORY_LABELS = {
  governance: 'Governance',
  operations: 'Operations',
  technology: 'Technology',
  marketing: 'Marketing',
  sales: 'Sales',
  customer_experience: 'Customer Experience',
  finance: 'Finance',
  security: 'Security',
  resilience: 'Resilience',
  knowledge: 'Knowledge',
  learning: 'Learning',
};

const REASON_WHEN_ZERO = {
  governance: 'no real Level 2 (Escalate) process found in the audit',
  operations: 'no real Level 1 (Autonomous) process found in the audit',
  technology: 'no CI/CD workflow found in the audit',
  marketing: 'no real marketing automation exists anywhere in the ecosystem yet',
  sales: 'no real sales-pipeline automation exists anywhere in the ecosystem yet',
  customer_experience: 'no real automated support/onboarding beyond end-user self-service exists yet',
  finance: 'no real finance-operations automation exists on this entity (cushion evidence, where present, is counted under Resilience instead)',
  security: 'no dependency-review/security-specific CI check found in the audit',
  resilience: 'no real cushion dimension exists on this entity',
  knowledge: 'this entity has not been through the 2026-08-07 verified-infrastructure-pass reconciliation',
  learning: 'no real production learning loop exists yet -- the Owner Intervention Log has no real production entries',
};

function loadSignals() {
  const path = new URL('../../../platforms/autonomy-signals.json', import.meta.url);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function printEntityReport(signals) {
  const { categories, total } = scoreEntity(signals);
  console.log(`\n=== ${signals.entity} (${signals.kind}) ===`);
  for (const [category, label] of Object.entries(CATEGORY_LABELS)) {
    const value = categories[category];
    const reason = value === 0 ? ` -- ${REASON_WHEN_ZERO[category]}` : '';
    console.log(`  ${label}: ${value}${reason}`);
  }
  console.log(`  TOTAL: ${total}/100`);
  console.log(`  (signals as of ${signals.audited_date} -- re-audit to refresh)`);
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = {};
  for (const arg of rest) {
    const match = arg.match(/^--([a-z-]+)=(.*)$/s);
    if (match) flags[match[1].replace(/-/g, '_')] = match[2];
  }

  if (command !== 'report') {
    console.error('Usage: autonomy-score report [--entity=<id>]');
    process.exit(1);
  }

  const allSignals = loadSignals();

  if (flags.entity === 'dot') {
    const platformSignals = allSignals.filter((s) => s.kind === 'platform');
    const platformTotals = platformSignals.map((s) => scoreEntity(s).total);
    console.log(`\n=== Dot ecosystem: 29-platform average ===`);
    console.log(`  Average score: ${averageScore(platformTotals)}/100 (mean of ${platformTotals.length} individual platform scores below)`);
    for (const s of platformSignals) {
      console.log(`    ${s.entity}: ${scoreEntity(s).total}/100`);
    }
    const dotOwnEntity = allSignals.find((s) => s.entity === 'dot');
    if (dotOwnEntity) {
      console.log(`\n--- Dot.Brain's own entity score (separate from the platform average above) ---`);
      printEntityReport(dotOwnEntity);
    }
    return;
  }

  if (flags.entity) {
    const entitySignals = allSignals.find((s) => s.entity === flags.entity);
    if (!entitySignals) {
      console.error(`Unknown entity: ${flags.entity}`);
      process.exit(1);
    }
    printEntityReport(entitySignals);
    return;
  }

  for (const s of allSignals) {
    printEntityReport(s);
  }
  const platformTotals = allSignals.filter((s) => s.kind === 'platform').map((s) => scoreEntity(s).total);
  console.log(`\n=== Dot ecosystem: 29-platform average ===`);
  console.log(`  Average score: ${averageScore(platformTotals)}/100`);
}

main();
