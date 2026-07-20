import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The `boardwalk-api` half of the CLAUDE.md count guard. Its twin is `tests/claude-md-counts.test.ts`
 * in the repo root, and the split is deliberate: this package is OUTSIDE the npm workspace with its
 * own lockfile and its own CI job (`.github/workflows/api.yml`), so a root `npm ci` does not install
 * it. A single guard in the root would have to skip when it could not collect this package — and a
 * guard that skips is a guard that reports success by doing nothing, which is the failure mode
 * CLAUDE.md's Enforcement section exists to prevent. Each package guards the rows its own CI can
 * actually see; together they cover the table.
 *
 * This half is the one that had actually rotted. All three stale numbers found in the sweep that
 * wrote it were API numbers: the suite was called 188 when it was 238, and `api.test.ts` was
 * claimed as BOTH 19 and 21 on two different rows. Every frontend count was correct.
 *
 * As in the twin: the spawn MUST be inside the `it`. A `describe` body runs during collection, so
 * `vitest list` — which collects this file too — would re-enter and spawn another, forever.
 */

// `__dirname`, not `import.meta.dirname`: this package compiles to CommonJS (the frontend reads the
// shared rulebook's TypeScript source, the referee reads its built CJS — the asymmetry CLAUDE.md
// describes), and `import.meta` is a hard error under `module: commonjs`.
const API_ROOT = join(__dirname, '..');
const REPO_ROOT = join(API_ROOT, '..');

function claudeMd(): string {
  return readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
}

/** Every backticked boardwalk-api/tests/x.test.ts path followed by a parenthesised count. */
function claimedCounts(): Map<string, number> {
  const claims = new Map<string, number>();
  // A bare mention carries no claim and is ignored — the table names several of these files
  // without a count. Only a parenthesised number asserts something about today.
  const re = /`boardwalk-api\/(tests\/[A-Za-z0-9._-]+\.test\.ts)` \((\d+)\)/g;
  for (const [, file, count] of claudeMd().matchAll(re)) {
    // Both groups are non-optional in the pattern, so a match always has them; `strict` cannot
    // see that, and an assertion here would be a lie the day the pattern grows an optional group.
    if (file === undefined || count === undefined) continue;
    claims.set(file, Number(count));
  }
  return claims;
}

/** The whole-suite total quoted in the Develop section's `boardwalk-api` block. */
function claimedTotal(): number | null {
  const m = /npm test\s+# vitest — (\d+)/.exec(claudeMd());
  return m?.[1] === undefined ? null : Number(m[1]);
}

/** What Vitest actually collects here, per file, keyed relative to `boardwalk-api/`. */
function actualCounts(): Map<string, number> {
  const raw = execFileSync('npx', ['vitest', 'list', '--json'], {
    cwd: API_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const counts = new Map<string, number>();
  for (const t of JSON.parse(raw) as { file: string }[]) {
    const rel = t.file.startsWith(API_ROOT) ? t.file.slice(API_ROOT.length + 1) : t.file;
    counts.set(rel, (counts.get(rel) ?? 0) + 1);
  }
  return counts;
}

describe("CLAUDE.md's boardwalk-api test counts are the real ones", () => {
  it('quotes a count for most of this suite, so this guard is not vacuous', () => {
    // If the regex stops matching, the checks below pass over an empty set and report success.
    // 5 is well under the ~8 claimed today and far above anything a broken parser would return.
    expect(claimedCounts().size).toBeGreaterThan(5);
    expect(claimedTotal()).not.toBeNull();
  });

  it('quotes the number Vitest actually collects, for every file it names', () => {
    const claims = claimedCounts();
    const actual = actualCounts();
    expect(actual.size).toBeGreaterThan(5);

    // Report EVERY mismatch at once — fixing these one failed run at a time is how a stale count
    // survives a sweep: you correct the one the runner named and re-read a green board.
    const wrong = [...claims]
      .map(([file, claimed]) => ({ file, claimed, real: actual.get(file) }))
      .filter(({ claimed, real }) => real !== claimed)
      .map(({ file, claimed, real }) =>
        real === undefined
          ? `boardwalk-api/${file}: CLAUDE.md claims ${claimed}, but Vitest collects no such file`
          : `boardwalk-api/${file}: CLAUDE.md claims ${claimed}, actual ${real}`
      );

    expect(wrong, `CLAUDE.md's API test counts have drifted:\n  ${wrong.join('\n  ')}`).toEqual([]);
  });

  it("quotes the suite's real total in the Develop section", () => {
    // This is the line that was wrong by 50: `npm test  # vitest — 188` against a suite of 238.
    const total = [...actualCounts().values()].reduce((a, b) => a + b, 0);
    expect(claimedTotal(), `CLAUDE.md's Develop section quotes the wrong API suite total`).toBe(
      total
    );
  });
});
