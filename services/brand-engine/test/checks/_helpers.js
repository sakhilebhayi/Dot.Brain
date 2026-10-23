// Shared helpers for the built-in static check tests.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKS_DIR = fileURLToPath(new URL('../../src/analyze/checks/', import.meta.url));
export const FIXTURES = fileURLToPath(new URL('../fixtures/checks/', import.meta.url));

/** Every check module in the folder, the way a registry that auto-loads the folder would find them. */
export async function loadChecks() {
  const out = new Map();
  for (const f of readdirSync(CHECKS_DIR).filter((n) => n.endsWith('.js') && !n.startsWith('_')).sort()) {
    const mod = (await import(pathToFileURL(join(CHECKS_DIR, f)))).default;
    out.set(mod.id, { mod, file: f });
  }
  return out;
}

/** A resolved-profile shaped object (what `profile resolve` returns), small and made up for these tests. */
export const PROFILE = Object.freeze({
  id: 'fixture',
  language: {
    banned_phrases: [{ text: 'seamless', origin: 'fixture@0.1.0' }, { text: 'game-changing', origin: 'fixture@0.1.0' }],
    claims_policy: {
      forbidden: [
        { id: 'no-invented-customer-counts', rule: 'Do not state or imply a number of customers or users.', origin: 'fixture@0.1.0' },
        { id: 'no-compliance-claims', rule: 'Do not claim compliance or certification.', origin: 'fixture@0.1.0' },
        { id: 'no-performance-claims', rule: 'No claim about returns or profit.', origin: 'fixture@0.1.0' },
      ],
      evidence_required: [],
    },
  },
  visual_direction: { source_refs: [], constraints: [], prohibited: [{ text: 'Generic Arial-only interfaces', origin: 'fixture@0.1.0' }] },
});

export const ruleOf = (f) => f.id.split('.')[2];
/** "rule severity file:line" for every finding, in the order the check returned them. */
export const brief = (result) => result.findings.map((f) => `${ruleOf(f)} ${f.severity} ${f.location ? `${f.location.file}:${f.location.line}` : '-'}`);
/** Why a check is not_measured: the analyzer allows no extra key in a result, so it travels as an info finding. */
export const reasonOf = (result) => result.findings.find((f) => ruleOf(f) === 'not-measured')?.message;
/** The findings that say something about the repository (not the \"not measured\" note). */
export const substantive = (result) => result.findings.filter((f) => ruleOf(f) !== 'not-measured');

export function runOn(checks, id, root, profile = PROFILE, extra = {}) {
  return checks.get(id).mod.run({ root, profile, ...extra });
}

const made = [];
/** Create a throwaway checkout from { 'relative/path': 'content' }. Removed at process exit. */
export function tmpRepo(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'brand-checks-'));
  made.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });
