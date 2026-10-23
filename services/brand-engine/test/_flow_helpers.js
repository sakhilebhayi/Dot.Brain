// Helpers for the analyse / plan / verify / assemble tests. Everything built here is a TEST FIXTURE.
import { createHash } from 'node:crypto';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableStringify } from '../src/json.js';
import { loadBrandDir } from '../src/registry.js';
import { loadRubric } from '../src/score/rubric.js';
import { canonicalHash } from '../src/score/util.js';
import { BRAND, runCli } from './_helpers.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
export const E2E_PRODUCT = here('./fixtures/e2e/product/');
export const E2E_CHECKS = here('./fixtures/e2e/checks/');
export const ANALYZE_CHECKS = here('./fixtures/analyze-checks/');
export const EMPTY_CHECKS = here('./fixtures/empty-checks/');
export const REGISTRY_CHECKS = here('./fixtures/registry-checks/');
export const REPORTS = here('./fixtures/reports/');
export const ENGINE_ROOT = here('../');
export const BUNDLE = loadRubric(BRAND, 'bxqs-1.0.0');
export const REG = loadBrandDir(BRAND);

export const tmp = (prefix = 'flow-') => mkdtempSync(join(tmpdir(), prefix));

export function writeText(path, text) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

/** A temporary copy of the e2e fixture product, optionally with a fake .git (HEAD, ref and an origin that carries a token). */
export function copyProduct({ git = false } = {}) {
  const dir = tmp('flow-product-');
  cpSync(E2E_PRODUCT, dir, { recursive: true });
  if (git) {
    writeText(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeText(join(dir, '.git', 'refs', 'heads', 'main'), `${'0123456789abcdef'.repeat(2)}01234567\n`);
    writeText(join(dir, '.git', 'config'), `[remote "origin"]\n\turl = https://x-access-token:${FAKE_TOKEN}@github.com/example/e2e-product.git\n`);
  }
  return dir;
}
/** A credential-SHAPED string built at run time (a literal would trip secret scanners). Not a real token. */
export const FAKE_TOKEN = `gh${'p'}_${'A1b2C3'.repeat(6)}`;
export const FAKE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

/** sha256 over every path and byte under a directory: proves a run changed nothing. */
export function checksum(dir) {
  const h = createHash('sha256');
  const walk = (rel) => {
    for (const name of readdirSync(join(dir, rel)).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      const st = lstatSync(join(dir, r));
      h.update(`${r}|${st.isDirectory() ? 'd' : st.isSymbolicLink() ? 'l' : 'f'}|${st.mode}\n`);
      if (st.isDirectory()) walk(r);
      else if (st.isFile()) h.update(readFileSync(join(dir, r)));
    }
  };
  walk('');
  return h.digest('hex');
}

export const flow = (args, env) => runCli(args, env);
export const analyzeArgs = (dir, extra = []) => ['analyze', dir, '--checks-dir', E2E_CHECKS, ...extra];

/** Analyse a directory through the CLI and return {code, analysis, stdout, stderr}. */
export function analyzeCli(dir, extra = [], checks = E2E_CHECKS) {
  const r = runCli(['analyze', dir, '--checks-dir', checks, ...extra]);
  let analysis = null;
  try { analysis = JSON.parse(r.stdout); } catch { /* not JSON (an --out run prints the summary) */ }
  return { ...r, analysis };
}

/** Seal a hand-built document the way the engine does (integrity = canonical hash of the rest). */
export function seal(doc) {
  const { integrity, ...rest } = doc;
  return { ...rest, integrity: { sha256: canonicalHash(rest) } };
}

export const writeDoc = (path, doc) => writeText(path, `${stableStringify(doc)}\n`);

/** A minimal, sealed, valid analysis document for unit tests of plan and verify. */
export function makeAnalysis({ findings = [], evidence = [], domainOverrides = [], principleRefs = [], input = {}, profile = {}, rubric, checks } = {}) {
  const doc = {
    analysis_version: '1.0.0',
    engine_version: '0.2.0',
    input: { repo: 'example/fixture', commit: FAKE_COMMIT, commit_source: 'git', ...input },
    rubric: rubric ?? { id: BUNDLE.rubric.id, version: BUNDLE.rubric.version, sha256: BUNDLE.sha256 },
    profile: {
      id: 'fixture-product', kind: 'product', version: '0.1.0', effective_status: 'draft', chain: ['fixture-product@0.1.0'],
      sha256: 'a'.repeat(64), source: 'file', domain_overrides: domainOverrides, principle_refs: principleRefs, ...profile,
    },
    themes: ['light', 'dark'],
    checks: checks ?? [],
    evidence: evidence.map((e) => ({ source_class: 'automated_check', result: e.value === 1 ? 'pass' : e.value === 0 ? 'fail' : 'partial', artifact_ref: 'fixture', origin: `check:${e.check_id}`, ...e })),
    findings: findings.map((f, i) => {
      const fingerprint = (f.fingerprint ?? `${String(i).padStart(12, '0')}`).slice(0, 12);
      return {
        id: `${f.check_id}.${fingerprint}`, fingerprint, source_id: 'fixture', severity: 'major', dimension: 'accessibility_inclusion',
        message: 'A fixture finding', fix_hint: 'Fix the fixture.', origin: `check:${f.check_id}`, ...f,
      };
    }),
    not_measured: [], conflicts: [],
    coverage: { skipped: [], skipped_total: 0 },
    reports: { ingested: [], skipped: [], superseded: [], notes: [] },
    engine_problems: [],
    counts: { checks: 0, evidence: 0, findings: 0, by_severity: { blocker: 0, major: 0, minor: 0, info: 0 }, not_measured: 0, redactions: 0 },
  };
  return seal(doc);
}
