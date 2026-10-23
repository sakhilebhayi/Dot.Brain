#!/usr/bin/env node
// Install the dot-brand-experience skill for Claude Code.
//
//   node services/brand-engine/skill/install.js [--dest <dir>] [--dry-run] [--force]
//
// Copies skill/dot-brand-experience/ (SKILL.md and references/) to
// ~/.claude/skills/dot-brand-experience, and writes one extra file there,
// engine.path, holding the absolute path of THIS checkout's engine CLI so the
// skill does not have to search the disk. Nothing else is written.
//
//   * It never overwrites a file that differs from the source unless --force.
//   * It never deletes anything, and it ignores symlinks in the source.
//   * --dry-run lists what it would do and writes nothing.
//   * It makes no network call and runs no other program. Re-run it after
//     `git pull` in Dot.Brain to update the skill; the Dot.Brain checkout must
//     stay where it is, because the skill runs the engine from there.
//
// This script is NOT run by any test against the real home directory, and it
// is not run automatically by anything: installing a skill is the owner's call.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_NAME = 'dot-brand-experience';
const HERE = dirname(fileURLToPath(import.meta.url));
export const SKILL_SOURCE = join(HERE, SKILL_NAME);
export const ENGINE_CLI = resolve(HERE, '..', 'src', 'cli.js');

export const defaultDest = (home = homedir()) => join(home, '.claude', 'skills', SKILL_NAME);

/** Every regular file under `dir`, as paths relative to it (sorted). Symlinks are skipped. */
function listFiles(dir, rel = '') {
  const out = [];
  for (const name of readdirSync(join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${name}` : name;
    const st = lstatSync(join(dir, r));
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) out.push(...listFiles(dir, r));
    else if (st.isFile()) out.push(r);
  }
  return out;
}

/**
 * Work out what installing would do. Pure apart from reading the source and the destination.
 * Returns { files: [{ path, action: 'create' | 'same' | 'update' | 'conflict', content }] }.
 */
export function plan({ source = SKILL_SOURCE, dest, enginePath = ENGINE_CLI } = {}) {
  const wanted = listFiles(source).map((path) => ({ path, content: readFileSync(join(source, path), 'utf8') }));
  wanted.push({ path: 'engine.path', content: `${enginePath}\n` });
  const files = wanted.map((f) => {
    const target = join(dest, f.path);
    if (!existsSync(target)) return { ...f, action: 'create' };
    const st = lstatSync(target);
    if (!st.isFile()) return { ...f, action: 'conflict' };
    return { ...f, action: readFileSync(target, 'utf8') === f.content ? 'same' : f.path === 'engine.path' ? 'update' : 'conflict' };
  });
  return { dest, files };
}

/** Install. Returns { written: string[], unchanged: string[] }. Throws if a file would be overwritten without force. */
export function install({ source = SKILL_SOURCE, dest, enginePath = ENGINE_CLI, dryRun = false, force = false } = {}) {
  if (!dest) throw new Error('install needs a destination');
  if (!existsSync(join(source, 'SKILL.md'))) throw new Error(`${source} has no SKILL.md`);
  const { files } = plan({ source, dest, enginePath });
  const conflicts = files.filter((f) => f.action === 'conflict');
  if (conflicts.length && !force) {
    throw new Error(`refusing to overwrite ${conflicts.map((f) => f.path).join(', ')} in ${dest}; they differ from this checkout (re-run with --force to replace them)`);
  }
  const written = [];
  const unchanged = [];
  for (const f of files) {
    if (f.action === 'same') { unchanged.push(f.path); continue; }
    written.push(f.path);
    if (dryRun) continue;
    const target = join(dest, f.path);
    mkdirSync(dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, f.content);
    renameSync(tmp, target);
  }
  return { written, unchanged };
}

function parseArgs(argv) {
  const flags = { dryRun: false, force: false, dest: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--force') flags.force = true;
    else if (a === '--dest') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return { error: '--dest needs a directory' };
      flags.dest = v;
      i += 1;
    } else return { error: `unknown argument ${a}` };
  }
  return { flags };
}

export function main(argv, { out = console.log, err = console.error, home = homedir() } = {}) {
  const parsed = parseArgs(argv);
  if (parsed.error) { err(`${parsed.error}\nusage: node install.js [--dest <dir>] [--dry-run] [--force]`); return 2; }
  const dest = resolve(parsed.flags.dest ?? defaultDest(home));
  try {
    const result = install({ dest, dryRun: parsed.flags.dryRun, force: parsed.flags.force });
    const verb = parsed.flags.dryRun ? 'would write' : 'wrote';
    for (const p of result.written) out(`${verb} ${join(dest, p)}`);
    for (const p of result.unchanged) out(`unchanged ${join(dest, p)}`);
    out(parsed.flags.dryRun ? `dry run: nothing written. Skill ${SKILL_NAME} would be installed in ${dest}` : `installed ${SKILL_NAME} in ${dest}. Start a new Claude Code session to load it. The skill runs ${ENGINE_CLI}, so keep this Dot.Brain checkout where it is.`);
    return 0;
  } catch (error) {
    err(error.message);
    return 2;
  }
}

// Run as a script (also through a symlinked path), not when imported by a test.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
