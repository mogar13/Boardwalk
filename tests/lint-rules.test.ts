/**
 * Does the lint config catch the things it was adopted to catch?
 *
 * A linter that matches nothing reports success, and the axes along which it goes
 * blind are dull: a `files:` glob that misses an extension, a plugin that renames
 * an export, a parser that cannot build a program for the file and reports a parse
 * error where a rule result was expected. VS-Dashboard shipped exactly this —
 * `check-native-dialogs.sh` said "ok" for a month while `confirm('Clear the entire
 * workspace?')` sat in a `.js` file its include list did not cover.
 *
 * So: every rule is asserted to FIRE on the bug, and asserted NOT to fire on the
 * sanctioned pattern (a rule that cries wolf is disabled by the first person it
 * annoys, and then it protects nothing).
 *
 * These lint the REAL `eslint.config.mjs`, loaded from disk. A rule that works
 * under a bespoke test config and not under the real one is the failure being
 * guarded against, not a passing test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ESLint } from 'eslint';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = join(ROOT, 'src', '__lint_fixtures__');

/**
 * Every fixture, written to disk ONCE before any linting happens.
 *
 * Both halves of that sentence are load-bearing, and each cost a red run:
 *
 * ON DISK, not `lintText()` with a virtual path. Type-aware rules run through
 * `projectService`, and TypeScript can only answer questions about a file that is
 * really in the program. A virtual path under `src/` is not — so every type-aware
 * assertion comes back a PARSE ERROR, which ESLint reports *instead of* a rule
 * result. A test reading "no rule fired" as "no bug" would go green on all of them.
 *
 * ONCE, UP FRONT, not per-test. The project service caches its file list at the
 * first lint, and that cache outlives an `new ESLint()` instance — so a fixture
 * created lazily by the second test was "not found by the project service" even
 * though its own directory was in `include`. The `.ts` case passed and the `.tsx`
 * case failed purely because of the order they ran in.
 *
 * The explicit `fatal` assertion in `rulesFiredOn` is what turned both of those
 * from a silent green into a loud red.
 */
const FIXTURES: Record<string, string> = {
  'dialogs.ts': `export function boom(msg: string): void {
  alert('you win');
  confirm(msg);
  prompt('name?');
}`,
  // NOT `dialogs.tsx`. A `.ts` and a `.tsx` with the same basename resolve to the
  // same module, so TypeScript keeps the `.ts` and silently drops the `.tsx` from
  // the program — at which point ESLint cannot parse it and this suite's .tsx
  // coverage tests nothing. That is this file's own thesis (a guard goes blind
  // along the extension axis) landing on the guard itself, and only the `fatal`
  // assertion in `rulesFiredOn` turned it into a red run instead of a green one.
  'dialogs-component.tsx': `export function Boom(props: { msg: string }): null {
  alert('you win');
  confirm(props.msg);
  prompt('name?');
  return null;
}`,
  'indirect.ts': `export function boom(msg: string): void {
  confirm(msg);
}`,
  'scoped.ts': `function useToast(): { confirm: (m: string) => boolean } {
  return { confirm: (m: string) => m.length > 0 };
}
export function ok(): void {
  const { confirm } = useToast();
  confirm('Leave the table?');
}`,
  'deep/deeper/bad.ts': `import { thing } from '../../system/thing';
export const x = thing;`,
  'deep/deeper/deepest/worse.ts': `import { thing } from '../../../system/thing';
export const x = thing;`,
  'deep/ok-relative.ts': `import { sibling } from '../sibling';
export const x = sibling;`,
  'ok-alias.ts': `import App from '@/App';
export const x = App;`,
  'floating.ts': `async function work(): Promise<void> {}
export function go(): void {
  work();
}`,
};

beforeAll(() => {
  for (const [rel, code] of Object.entries(FIXTURES)) {
    const abs = join(FIXTURE_DIR, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, code);
  }
});

afterAll(() => {
  // Always, even on a failed assertion. A fixture left under `src/` is not merely
  // untidy — it is a deliberate lint error and a type error inside the real tree,
  // so it would fail `npm run lint` and `tsc -b` for the next person, on a file
  // they never wrote.
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

/** Lint one fixture with the real config; return the rule ids that fired. */
async function rulesFiredOn(rel: string): Promise<(string | null)[]> {
  const abs = join(FIXTURE_DIR, rel);
  const eslint = new ESLint({ cwd: ROOT });
  const results = await eslint.lintFiles([abs]);
  const messages = results.flatMap((r) => r.messages);
  const fatal = messages.filter((m) => m.fatal);
  expect(
    fatal.map((m) => m.message),
    `ESLint could not PARSE ${rel} — a file it cannot parse is a file it is not linting, which is the whole failure mode this suite exists for`
  ).toEqual([]);
  return messages.map((m) => m.ruleId);
}

describe('native dialogs are unspellable', () => {
  // `.ts` AND `.tsx`, because the file extension is the exact axis along which the
  // reference implementation's guard went blind for a month.
  for (const fixture of ['dialogs.ts', 'dialogs-component.tsx']) {
    it(`no-restricted-globals fires on alert/confirm/prompt in ${fixture}`, async () => {
      const fired = await rulesFiredOn(fixture);
      expect(fired.filter((r) => r === 'no-restricted-globals')).toHaveLength(3);
    });
  }

  it('sees through confirm(someVariable) — the case a grep cannot', async () => {
    expect(await rulesFiredOn('indirect.ts')).toContain('no-restricted-globals');
  });

  it("does NOT fire on a local binding named confirm — the kit's future shape", async () => {
    // Phase 1 ships `const { confirm } = useToast()`-shaped APIs. A rule that fires
    // on those gets disabled by the first person it annoys, and then it guards
    // nothing. `no-restricted-globals` is scope-aware; this proves it.
    expect(await rulesFiredOn('scoped.ts')).not.toContain('no-restricted-globals');
  });
});

describe('the @/ alias is enforced', () => {
  it('fires on a ../../ import', async () => {
    expect(await rulesFiredOn('deep/deeper/bad.ts')).toContain('no-restricted-imports');
  });

  it('fires on ../../../ too — a deeper escape is not a loophole', async () => {
    // '../../**' must match across slashes. If it silently didn't, the rule would
    // catch the shallowest offender and miss the worst one.
    expect(await rulesFiredOn('deep/deeper/deepest/worse.ts')).toContain('no-restricted-imports');
  });

  it('does NOT fire on a single ../ — a sibling is a real relationship', async () => {
    expect(await rulesFiredOn('deep/ok-relative.ts')).not.toContain('no-restricted-imports');
  });

  it('does NOT fire on the @/ alias itself', async () => {
    expect(await rulesFiredOn('ok-alias.ts')).not.toContain('no-restricted-imports');
  });
});

describe('type-aware linting is actually on', () => {
  it('fires a rule that is IMPOSSIBLE without type information', async () => {
    // The canary. If `projectService` silently stops resolving, every type-aware
    // rule goes quiet and the config degrades to syntax-only — while still
    // reporting success. `no-floating-promises` cannot be decided without knowing
    // that `work()` returns a Promise, so it can only pass if types are live.
    expect(await rulesFiredOn('floating.ts')).toContain('@typescript-eslint/no-floating-promises');
  });
});
