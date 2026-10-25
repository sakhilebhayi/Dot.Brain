#!/usr/bin/env node
// services/brand-engine/ci/assess.js
//
// The small, testable helper behind .github/workflows/brand-assess.yml. The workflow is thin: it checks
// out Dot.Brain and a product repository, runs the engine CLI (analyze, evidence assemble, score) and
// calls this script for the parts that are not the engine's job: validating the workflow's inputs before
// they are used, resolving them to safe paths inside the product checkout, and turning score.json into a
// job summary, job outputs and an optional gate.
//
//   node ci/assess.js validate                      inputs from the environment (BRAND_ASSESS_*); exit 1 on any invalid one
//   node ci/assess.js prepare                       the same, then resolves paths inside BRAND_ASSESS_PRODUCT_DIR; prints key=value lines
//   node ci/assess.js summary --out-dir <dir>       Markdown for the job summary, from analysis.json, summary.md and score.json
//   node ci/assess.js outputs --out-dir <dir>       key=value lines for $GITHUB_OUTPUT (state, evidenced_score, blockers)
//   node ci/assess.js gate --out-dir <dir> --fail-on-blockers <true|false>
//                                                   exit 1 only when asked to fail and the score report lists a blocker
//
// It is read-only except for what the caller redirects, makes no network call, runs no other program and
// holds no secret. It does not score: every number it prints is copied from the engine's score.json as
// written. Advisory by default: the gate fails only on a blocker, and only when the caller opted in.
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readGitInfo } from '../src/analyze/git.js';
import { checkRelativePath } from '../src/rules.js';

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REF = /^[A-Za-z0-9_][A-Za-z0-9_./-]{0,199}$/;
const PROFILE_ID = /^[a-z][a-z0-9-]*(@\d+\.\d+\.\d+)?$/;
const BUILT_BY = /^[A-Za-z0-9_.@ -]{1,100}$/;
const THEMES = /^[a-z][a-z0-9_-]{0,39}(,[a-z][a-z0-9_-]{0,39})*$/;
const ARTIFACT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const SUMMARY_LIMIT = 20000; // characters of the analysis summary copied into the job summary

export const INPUT_NAMES = {
  repository: 'BRAND_ASSESS_REPOSITORY', ref: 'BRAND_ASSESS_REF', profile: 'BRAND_ASSESS_PROFILE', built_by: 'BRAND_ASSESS_BUILT_BY',
  themes: 'BRAND_ASSESS_THEMES', reports_path: 'BRAND_ASSESS_REPORTS_PATH', assessments_path: 'BRAND_ASSESS_ASSESSMENTS_PATH',
  observed_path: 'BRAND_ASSESS_OBSERVED_PATH', fail_on_blockers: 'BRAND_ASSESS_FAIL_ON_BLOCKERS', brain_ref: 'BRAND_ASSESS_BRAIN_REF',
  artifact_name: 'BRAND_ASSESS_ARTIFACT_NAME',
};

/** Defaults the workflow also declares. */
const DEFAULTS = { built_by: 'unspecified', themes: 'light,dark', fail_on_blockers: 'false', brain_ref: 'main', artifact_name: 'brand-assessment' };

export function readInputs(env) {
  const inputs = {};
  for (const [name, key] of Object.entries(INPUT_NAMES)) {
    const v = env[key];
    inputs[name] = v === undefined || v === '' ? (DEFAULTS[name] ?? '') : v;
  }
  return inputs;
}

/** Every problem with the workflow inputs. An empty list means they are safe to use. */
export function validateInputs(inputs) {
  const errors = [];
  const bad = (name, why) => errors.push(`${name}: ${why}`);
  if (/[\u0000-\u001f\u007f]/.test(Object.values(inputs).join(''))) errors.push('inputs: control characters are not allowed');
  if (inputs.repository !== '' && !REPO.test(inputs.repository)) bad('repository', 'must look like owner/name (or be empty for the calling repository)');
  if (inputs.ref !== '' && (!REF.test(inputs.ref) || inputs.ref.includes('..') || inputs.ref.endsWith('/'))) bad('ref', 'must be a branch, tag or commit name (or empty for the default branch)');
  if (!REF.test(inputs.brain_ref) || inputs.brain_ref.includes('..')) bad('brain_ref', 'must be a branch, tag or commit of Dot.Brain');
  if (inputs.profile !== '') {
    if (inputs.profile.endsWith('.json')) {
      const why = checkRelativePath(inputs.profile);
      if (why) bad('profile', `a path in the product repository ${why}`);
    } else if (!PROFILE_ID.test(inputs.profile)) bad('profile', 'must be a Dot.Brain profile id such as infodot (or infodot@0.1.0), or a path ending .json inside the product repository');
  }
  if (!BUILT_BY.test(inputs.built_by)) bad('built_by', 'must be 1 to 100 letters, digits, spaces or . _ @ -');
  if (!THEMES.test(inputs.themes)) bad('themes', 'must be a comma-separated list of names such as light,dark');
  for (const name of ['reports_path', 'assessments_path', 'observed_path']) {
    if (inputs[name] === '') continue;
    const why = checkRelativePath(inputs[name]);
    if (why) bad(name, `a path in the product repository ${why}`);
  }
  if (inputs.fail_on_blockers !== 'true' && inputs.fail_on_blockers !== 'false') bad('fail_on_blockers', 'must be true or false');
  if (!ARTIFACT.test(inputs.artifact_name)) bad('artifact_name', 'must be 1 to 100 letters, digits, . _ or -');
  return errors;
}

const inside = (child, parent) => child === parent || child.startsWith(parent + sep);

/**
 * Resolve an optional path inside the product checkout. A symlink that leaves the checkout (a product
 * repository is not trusted) and anything of the wrong type is refused. Returns the real path or throws.
 */
function resolveInside(productReal, rel, what, type) {
  const full = join(productReal, rel);
  if (!existsSync(full)) throw new Error(`${what}: ${rel} does not exist in the product repository`);
  const real = realpathSync(full);
  if (!inside(real, productReal)) throw new Error(`${what}: ${rel} leaves the product checkout`);
  const st = lstatSync(real);
  if (type === 'dir' ? !st.isDirectory() : !st.isFile()) throw new Error(`${what}: ${rel} is not a ${type === 'dir' ? 'directory' : 'regular file'}`);
  return real;
}

/** Validate, then resolve the inputs against the product checkout. Returns { profile, reports, assessments, observed } (absolute or empty). */
export function prepare(inputs, productDir) {
  const errors = validateInputs(inputs);
  if (errors.length) throw new Error(errors.join('\n'));
  if (!existsSync(productDir)) throw new Error(`product checkout ${productDir} does not exist`);
  const productReal = realpathSync(productDir);
  // The engine reads the commit and owner/name from .git itself; stop early, and say why, if it cannot.
  const git = readGitInfo(productReal);
  if (!git.commit || !git.repo) throw new Error('the product checkout has no readable commit or GitHub origin (.git); the assessment records which commit it describes, so it will not run without one');
  const out = { profile: '', reports: '', assessments: '', observed: '' };

  if (inputs.profile === '') {
    const local = join('brand', 'profile.json');
    if (!existsSync(join(productReal, local))) throw new Error('profile: the product has no brand/profile.json; set the profile input to a Dot.Brain profile id such as infodot, or to a path to a profile inside the product repository');
    out.profile = resolveInside(productReal, local, 'profile', 'file');
  } else if (inputs.profile.endsWith('.json')) out.profile = resolveInside(productReal, inputs.profile, 'profile', 'file');
  else out.profile = inputs.profile;

  if (inputs.reports_path) out.reports = resolveInside(productReal, inputs.reports_path, 'reports_path', 'dir');
  if (inputs.assessments_path) out.assessments = resolveInside(productReal, inputs.assessments_path, 'assessments_path', 'file');
  if (inputs.observed_path) out.observed = resolveInside(productReal, inputs.observed_path, 'observed_path', 'file');
  return out;
}

// ------------------------------------------------------------------ the report

const readJsonIf = (path) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
};
const readTextIf = (path) => {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
};
const code = (s) => `\`${String(s).replace(/`/g, "'").replace(/[\r\n|]+/g, ' ')}\``;
const cell = (s) => String(s).replace(/[|\r\n]+/g, ' ').replace(/([\\`*_{}[\]<>])/g, '\\$1');

/** The headline fields of a score report, copied as written. */
export function headlineOf(score) {
  return {
    state: score.state,
    evidenced_score: score.headline.evidenced_score,
    out_of: score.headline.out_of,
    ceiling: score.headline.ceiling,
    attainment_percent: score.headline.attainment_percent,
    confidence: score.confidence.band,
    blockers: score.blockers.length,
  };
}

/** Markdown for the job summary. Missing files are reported as missing, never filled in. */
export function renderSummary({ outDir }) {
  const analysis = readJsonIf(join(outDir, 'analysis.json'));
  const score = readJsonIf(join(outDir, 'score.json'));
  const L = ['# Brand experience assessment', ''];
  L.push('Advisory. This run read a checkout and wrote no file into it, commit nothing, post nothing to Dot.Memory or Dot.Dopemine, and used no secret. It measures nothing about how people feel.', '');
  if (!analysis) {
    L.push('**The analysis did not complete**, so there is nothing to report. See the failed step in this run.', '');
    return `${L.join('\n')}\n`;
  }
  L.push(`- Repository: ${cell(analysis.input.repo ?? 'unknown')}; commit: ${cell(analysis.input.commit ?? 'unknown')}`);
  L.push(`- Profile: ${cell(analysis.profile.id)}@${cell(analysis.profile.version)} (${cell(analysis.profile.effective_status)}); rubric ${cell(analysis.rubric.id)}@${cell(analysis.rubric.version)} sha256 ${cell(analysis.rubric.sha256)}`, '');
  if (!score) {
    L.push('**The score was not produced** (evidence assembly or scoring failed). The analysis is attached as an artifact.', '');
  } else {
    const h = headlineOf(score);
    L.push('| Evidenced score | Ceiling | Attainment | State | Confidence | Blockers |', '|---|---|---|---|---|---|');
    L.push(`| ${h.evidenced_score} / ${h.out_of} | ${h.ceiling} | ${h.attainment_percent} % | ${code(h.state)} | ${code(h.confidence)} | ${h.blockers} |`, '');
    L.push('The ceiling is what automated and expert evidence alone can earn. The rest of the 100 needs observed behaviour or customer feedback, which this run cannot supply. Numbers are copied from score.json as the engine wrote them.', '');
    if (score.blockers.length) {
      L.push('## Blockers', '');
      for (const b of score.blockers) L.push(`- ${code(b.finding_id)} ${code(b.kind)} in ${code(b.dimension)}: ${cell(b.text)} (${cell(b.artifact_ref ?? 'no location')})`);
      L.push('');
    }
    const missing = score.missing_evidence.length;
    const notMeasured = score.dimensions.filter((d) => d.status === 'not_measured').length;
    L.push(`${missing} check or metric(s) had no evidence and count as zero; ${notMeasured} of ${score.dimensions.length} dimensions are not measured. The list is in score.json.`, '');
  }
  const summary = readTextIf(join(outDir, 'summary.md'));
  if (summary) {
    L.push('## Analysis', '');
    const body = summary.replace(/^# .*\n+/, '');
    L.push(body.length > SUMMARY_LIMIT ? `${body.slice(0, SUMMARY_LIMIT)}\n\n(truncated; the full summary.md is in the artifact)` : body);
  }
  return `${L.join('\n')}\n`;
}

export function renderOutputs({ outDir }) {
  const score = readJsonIf(join(outDir, 'score.json'));
  if (!score) return '';
  const h = headlineOf(score);
  return `state=${h.state}\nevidenced_score=${h.evidenced_score}\nblockers=${h.blockers}\n`;
}

/** 0 unless the caller asked to fail on blockers and the score lists at least one. A missing score is an engine error, handled by the failed step. */
export function gate({ outDir, failOnBlockers }) {
  if (failOnBlockers !== 'true') return { code: 0, message: '' };
  const score = readJsonIf(join(outDir, 'score.json'));
  if (!score) return { code: 1, message: 'fail_on_blockers is true and there is no score report to check' };
  if (score.blockers.length === 0) return { code: 0, message: '' };
  return { code: 1, message: `${score.blockers.length} blocker(s) in the score report and fail_on_blockers is true: ${score.blockers.map((b) => b.finding_id).join(', ')}` };
}

// ------------------------------------------------------------------ command line

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function main(argv, { env = process.env, out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(`${s}\n`) } = {}) {
  const [command] = argv;
  try {
    if (command === 'validate' || command === 'prepare') {
      const inputs = readInputs(env);
      if (command === 'validate') {
        const errors = validateInputs(inputs);
        if (errors.length) { for (const e of errors) err(`invalid input: ${e}`); return 1; }
        return 0;
      }
      const product = env.BRAND_ASSESS_PRODUCT_DIR;
      if (!product) { err('BRAND_ASSESS_PRODUCT_DIR is not set'); return 1; }
      const r = prepare(inputs, resolve(product));
      for (const [k, v] of Object.entries(r)) out(`${k}=${v}\n`);
      return 0;
    }
    const outDir = flag(argv, '--out-dir');
    if (!outDir) { err('usage: assess.js validate | prepare | summary --out-dir <dir> | outputs --out-dir <dir> | gate --out-dir <dir> --fail-on-blockers <true|false>'); return 2; }
    if (command === 'summary') { out(renderSummary({ outDir })); return 0; }
    if (command === 'outputs') { out(renderOutputs({ outDir })); return 0; }
    if (command === 'gate') {
      const failOnBlockers = flag(argv, '--fail-on-blockers');
      if (failOnBlockers !== 'true' && failOnBlockers !== 'false') { err('--fail-on-blockers must be true or false'); return 2; }
      const r = gate({ outDir, failOnBlockers });
      if (r.message) err(r.message);
      return r.code;
    }
    err('usage: assess.js validate | prepare | summary --out-dir <dir> | outputs --out-dir <dir> | gate --out-dir <dir> --fail-on-blockers <true|false>');
    return 2;
  } catch (error) {
    err(`invalid input: ${error.message}`);
    return 1;
  }
}

// Run as a script (also through a symlinked path), not when imported by a test.
if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) process.exitCode = main(process.argv.slice(2));
