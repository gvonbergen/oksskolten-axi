import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Regression tests for the direct-execution gate in src/cli.ts.
 * Previously the gate compared process.argv[1] with import.meta.url by raw
 * string equality, so any symlinked bin (npm link / `npm install -g`) failed
 * the check and every command silently exited 0 with no output. We spawn the
 * built entry through a symlink instead of depending on any global install.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'dist', 'cli.js');

beforeAll(() => {
  // The gate lives in dist/cli.js, so the test needs a fresh build of src/.
  execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'pipe' });
}, 60_000);

const VERSION = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;

describe('entrypoint gate (src/cli.ts)', () => {
  it('runs main() when invoked through a symlink, like an installed bin', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oks-entry-'));
    const link = join(dir, 'oks');
    symlinkSync(CLI, link);
    const stdout = execFileSync(process.execPath, [link, '--version'], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(stdout.trim()).toBe(VERSION);
  });

  it('still runs main() when the real path is invoked directly', () => {
    const stdout = execFileSync(process.execPath, [CLI, '--version'], { encoding: 'utf8' });
    expect(stdout.trim()).toBe(VERSION);
  });

  it('prints the full help when run through a symlink', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oks-entry-'));
    const link = join(dir, 'oks');
    symlinkSync(CLI, link);
    const stdout = execFileSync(process.execPath, [link, '--help'], { encoding: 'utf8' });
    expect(stdout.length).toBeGreaterThan(100);
    expect(stdout).toContain('Usage: oks');
  });

  it('importing the module as a script has no side effects (test-only import is preserved)', () => {
    const code = `await import(${JSON.stringify(pathToFileURL(CLI).href)}); process.stdout.write('imported');`;
    const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
      encoding: 'utf8',
    });
    expect(stdout).toBe('imported');
  });
});