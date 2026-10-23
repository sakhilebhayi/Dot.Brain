// services/brand-engine/src/analyze/registry.js
//
// Auto-loads every check module in a directory (by default ./checks/), checks
// each against the contract (check-shape.js), and runs them with a timeout
// and full error isolation:
//
//   - every file in the directory that is a "<id>.js" module is a check;
//     "_lib/", files starting "_", sub-directories and non-.js files are
//     ignored; a symlink or a mis-named file is reported, not loaded;
//   - each check runs in its own worker thread (check-worker.js), so a loop, an
//     exception or a memory blow-up becomes a result for THAT check;
//   - a check that throws, times out, crashes or returns something that
//     violates the contract becomes status "not_measured" with an error
//     finding (engine: true). It is never a pass and never aborts the run.
import { lstatSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { normaliseCheckResult } from './check-shape.js';
import { CHECK_LIMITS } from './limits.js';
import { byText, safeText } from './text.js';

export const DEFAULT_CHECKS_DIR = fileURLToPath(new URL('./checks/', import.meta.url));
const WORKER_FILE = fileURLToPath(new URL('./check-worker.js', import.meta.url));

/** Which entries of a directory are check modules. Returns {files, problems}. */
export function listCheckFiles(dir) {
  const files = [];
  const problems = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return { files, problems }; // no checks directory: zero checks
    return { files, problems: [{ file: dir, message: `cannot read the checks directory (${error.code ?? 'error'})` }] };
  }
  for (const e of entries.sort((a, b) => byText(a.name, b.name))) {
    if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
    if (e.isDirectory()) continue;
    if (!e.name.endsWith('.js')) continue;
    const path = join(dir, e.name);
    let st;
    try { st = lstatSync(path); } catch { continue; }
    if (st.isSymbolicLink()) { problems.push({ file: e.name, message: 'a check module may not be a symlink' }); continue; }
    if (!st.isFile()) continue;
    files.push(path);
  }
  return { files, problems };
}

function runWorker(workerData, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    let timer;
    let meta;
    const worker = new Worker(WORKER_FILE, {
      workerData,
      env: {},
      stdout: true,
      stderr: true,
      resourceLimits: { maxOldGenerationSizeMb: CHECK_LIMITS.maxOldGenerationSizeMb, maxYoungGenerationSizeMb: 32 },
    });
    worker.stdout.resume();
    worker.stderr.resume();
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      resolve(value.meta || !meta ? value : { ...value, meta });
    };
    timer = setTimeout(() => finish({ kind: 'timeout' }), timeoutMs);
    worker.on('message', (m) => { if (m.kind === 'ready') meta = m.meta; else finish(m); });
    worker.once('error', (error) => finish({ kind: error && error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'oom' : 'error', message: error && error.message ? String(error.message) : 'worker error' }));
    worker.once('exit', (code) => finish({ kind: 'crashed', message: code === 13 ? 'the check returned a promise that never settled' : `the check process exited with code ${code} before returning` }));
  });
}

const scrubRoot = (message, root) => (root ? String(message).split(root).join('<root>') : String(message));
const fallbackId = (file) => `d0.${basename(file, '.js').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown'}`;

function errorOutcome(file, meta, code, message, root, sink) {
  const id = meta?.id ?? fallbackId(file);
  const text = safeText(scrubRoot(message, root), 300, sink);
  return {
    file: basename(file),
    meta: meta ?? { id, dimension: 'unknown', title: basename(file) },
    status: 'not_measured',
    evidence: [],
    findings: [{
      source_id: 'check-error',
      severity: 'major',
      dimension: meta?.dimension ?? 'unknown',
      check_id: id,
      message: `The check ${id} did not produce a result (${code}): ${text}`,
      fix_hint: 'Fix the check module or its inputs, then re-run analyze. Until then this check counts as not measured.',
      engine: true,
    }],
    error: { code, message: text },
    skipped: [],
  };
}

/**
 * Load the metadata of every check in `dir` (each module is imported inside a
 * worker, never in this thread). Returns {checks, errors}; `checks` are the
 * valid ones sorted by id.
 */
export async function loadChecks(dir = DEFAULT_CHECKS_DIR, { timeoutMs = CHECK_LIMITS.metaTimeoutMs } = {}) {
  const { files, problems } = listCheckFiles(dir);
  const errors = [...problems];
  const checks = [];
  const seen = new Map();
  const outcomes = await pool(files, CHECK_LIMITS.concurrency, (file) => runWorker({ mode: 'meta', file }, timeoutMs));
  outcomes.forEach((o, i) => {
    const name = basename(files[i]);
    if (o.kind === 'meta') {
      if (seen.has(o.meta.id)) errors.push({ file: name, message: `duplicate check id ${o.meta.id} (also in ${seen.get(o.meta.id)})` });
      else { seen.set(o.meta.id, name); checks.push({ ...o.meta, file: files[i] }); }
    } else if (o.kind === 'invalid') for (const p of o.problems) errors.push({ file: name, message: p });
    else errors.push({ file: name, message: o.kind === 'timeout' ? 'importing the module timed out' : `cannot import the module: ${safeText(o.message ?? o.kind, 200)}` });
  });
  checks.sort((a, b) => byText(a.id, b.id));
  return { checks, errors };
}

/**
 * Run one check file. Always resolves with an outcome:
 *   { file, meta, status, evidence, findings, error?, skipped }
 * where evidence/findings are normalised (bounded, scrubbed) and `error` is
 * present exactly when the check could not be trusted.
 */
export async function runCheck(file, { root, profile, themes, timeoutMs = CHECK_LIMITS.timeoutMs, sink } = {}) {
  const m = await runWorker({ mode: 'run', file, root, profile, themes }, timeoutMs);
  switch (m.kind) {
    case 'timeout': return errorOutcome(file, m.meta, 'timeout', `exceeded the ${timeoutMs} ms limit`, root, sink);
    case 'oom': return errorOutcome(file, m.meta, 'out_of_memory', 'exceeded its memory limit', root, sink);
    case 'invalid': return errorOutcome(file, null, 'invalid_module', m.problems.join('; '), root, sink);
    case 'crashed': return errorOutcome(file, m.meta, 'crashed', m.message, root, sink);
    case 'error': return errorOutcome(file, m.meta, 'threw', m.message, root, sink);
    case 'not_applicable':
      return { file: basename(file), meta: m.meta, status: 'not_applicable', evidence: [], findings: [], skipped: m.skipped ?? [] };
    case 'result': {
      const { problems, result } = normaliseCheckResult(m.result, sink);
      if (problems.length) return errorOutcome(file, m.meta, 'invalid_result', problems.slice(0, 5).join('; '), root, sink);
      return { file: basename(file), meta: m.meta, status: result.status, evidence: result.evidence, findings: result.findings, skipped: m.skipped ?? [] };
    }
    default: return errorOutcome(file, null, 'crashed', 'unexpected worker message', root, sink);
  }
}

/** Run every check in `dir`. Returns {outcomes, loadErrors}. */
export async function runChecks(dir, opts = {}) {
  const { files, problems } = listCheckFiles(dir);
  const outcomes = await pool(files, CHECK_LIMITS.concurrency, (file) => runCheck(file, opts));
  outcomes.sort((a, b) => byText(a.meta.id, b.meta.id) || byText(a.file, b.file));
  return { outcomes, loadErrors: problems };
}

async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(lanes);
  return results;
}


