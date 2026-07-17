/**
 * Does the file-size ratchet actually go red?
 *
 * CLAUDE.md: "test the enforcement — a lint rule that matches nothing reports
 * success." The ratchet's failure mode is worse than a lint rule's, because its
 * happy path and its dead path print the same thing: a guard whose `git ls-files`
 * filter stopped matching `src/` would report "✓ no new god-components" over a
 * 3,000-line file, forever, and the message would be true about what it saw.
 *
 * So these tests assert it FAILS. A green run of the guard proves nothing unless
 * something also proves the guard can be made to fail.
 *
 * The real script is COPIED into a throwaway git repo and run there, rather than
 * reimplemented or run against this tree. Two reasons: the script derives ROOT
 * from its own location and enumerates via `git ls-files`, so it needs a real repo
 * to be honest; and testing it here would mean writing an 800-line fixture into
 * `src/` and mutating the real baseline, where a failed assertion leaves both
 * behind and the next run is testing the wreckage of the last one.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_SRC = join(REPO, 'scripts', 'check-file-size.mjs');

let sandbox: string;

/** Run the guard in the sandbox. Returns exit code and combined output. */
function runGuard(args: string[] = []): { code: number; out: string } {
  try {
    const out = execFileSync('node', [join(sandbox, 'scripts', 'check-file-size.mjs'), ...args], {
      cwd: sandbox,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** Write `lines` lines to a tracked file in the sandbox repo. */
function writeTracked(relPath: string, lines: number): void {
  const abs = join(sandbox, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, Array.from({ length: lines }, (_, i) => `const l${i} = ${i};`).join('\n'));
  execSync(`git add "${relPath}"`, { cwd: sandbox });
}

/**
 * Untrack and delete a fixture.
 *
 * Not tidiness — correctness. Without it, the oversized file one test adds is still
 * tracked when the next one runs, so the guard keeps failing for the PREVIOUS
 * test's reason and the next two assertions go red having proven nothing about
 * themselves. Every test that makes the tree dirty must hand back a clean tree.
 */
function removeTracked(relPath: string): void {
  execSync(`git rm -q -f "${relPath}"`, { cwd: sandbox });
}

function baseline(): Record<string, number> {
  const raw = readFileSync(join(sandbox, 'scripts', 'file-size-baseline.json'), 'utf8');
  return JSON.parse(raw) as Record<string, number>;
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'bw-filesize-'));
  execSync('git init -q', { cwd: sandbox });
  execSync('git config user.email t@t.t && git config user.name t', { cwd: sandbox });
  mkdirSync(join(sandbox, 'scripts'), { recursive: true });
  cpSync(SCRIPT_SRC, join(sandbox, 'scripts', 'check-file-size.mjs'));
  writeFileSync(join(sandbox, 'scripts', 'file-size-baseline.json'), '{}\n');
  execSync('git add scripts', { cwd: sandbox });
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('file-size ratchet', () => {
  it('passes on a tree with no oversized files', () => {
    writeTracked('src/small.ts', 10);
    const { code, out } = runGuard();
    expect(code).toBe(0);
    expect(out).toContain('File-size guard');
  });

  it('FAILS on a new file born at the 800-line ceiling', () => {
    // Exactly 800: the guard is `>= CEILING`, so this is the boundary that decides
    // whether "800-line ceiling" means 800 or 801. An off-by-one here is invisible
    // in every other test.
    writeTracked('src/born.ts', 800);
    const { code, out } = runGuard();
    expect(code).toBe(1);
    expect(out).toContain('born over');
    expect(out).toContain('src/born.ts');
  });

  it('FAILS when a baselined file grows, and names the delta', () => {
    runGuard(['--init']); // src/born.ts is now fenced at 800
    expect(baseline()['src/born.ts']).toBe(800);

    expect(runGuard().code).toBe(0); // fenced: no longer a failure

    writeTracked('src/born.ts', 801); // ...until it grows by one line
    const { code, out } = runGuard();
    expect(code).toBe(1);
    expect(out).toContain('growing');
    expect(out).toContain('800 → 801');
  });

  it('PASSES when a baselined file shrinks, and asks for a re-lock', () => {
    writeTracked('src/born.ts', 700);
    const { code, out } = runGuard();
    expect(code).toBe(0); // shrinking is the allowed move — it must never fail
    expect(out).toContain('Shrank since baseline');
    expect(out).toContain('re-lock');
  });

  it('polices packages/ too, not just src/', () => {
    // `git ls-files` joined with the AREAS prefix filter is the exact seam that
    // would silently stop matching — and a guard that enumerates nothing prints
    // the same "✓" as a guard over a clean tree. Proving a *different* area still
    // trips it is what distinguishes those two states.
    writeTracked('packages/theme/huge.ts', 900);
    const { code, out } = runGuard();
    expect(code).toBe(1);
    expect(out).toContain('packages/theme/huge.ts');
    removeTracked('packages/theme/huge.ts');
  });

  it('ignores test files, which are allowed to be long', () => {
    // A table-driven test of every legal chess move SHOULD be 1,200 lines.
    writeTracked('src/games/chess/logic/moves.test.ts', 1200);
    expect(runGuard().code).toBe(0);
    removeTracked('src/games/chess/logic/moves.test.ts');
  });

  it('ignores untracked files — the build only ships what git ships', () => {
    const abs = join(sandbox, 'src', 'scratch.ts');
    writeFileSync(abs, Array.from({ length: 900 }, (_, i) => `const s${i} = ${i};`).join('\n'));
    expect(runGuard().code).toBe(0);
    rmSync(abs);
  });
});
