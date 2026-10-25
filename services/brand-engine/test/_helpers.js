import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { defaultBrandDir, loadBrandDir } from '../src/registry.js';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
export const FIXTURE = fileURLToPath(new URL('./fixtures/example-product/', import.meta.url));
export const BRAND = defaultBrandDir();

export const readJsonFile = (path) => JSON.parse(readFileSync(path, 'utf8'));
export const clone = (value) => structuredClone(value);

/** The registry over the real, shipped brand/ directory. */
export const shipped = () => loadBrandDir(BRAND);

export function profileDoc(id) {
  return readJsonFile(join(BRAND, 'profiles', `${id}.profile.json`));
}

/** A private, mutable copy of brand/ so a test can break it without touching the repo. */
export function copyBrandDir() {
  const dir = mkdtempSync(join(tmpdir(), 'brand-engine-'));
  cpSync(BRAND, dir, { recursive: true });
  return dir;
}

export function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function runCli(args, env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
