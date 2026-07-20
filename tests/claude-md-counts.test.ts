import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CLAUDE.md's Enforcement table quotes a test count for most guards — `tests/chess.test.ts` (40).
 * Those numbers are prose, and prose rots: three were stale at once after a phase landed (the API
 * suite was called 188 when it was 238, and `api.test.ts` was claimed as BOTH 19 and 21 on two
 * different rows of the same table). That is exactly the failure CLAUDE.md warns about in its own
 * Docs section — "don't state a present-tense fact unless something fails when it stops being
 * true" — landing on the file that says it. This is the something.
 *
 * It reads the real numbers out of Vitest's COLLECTOR rather than a run: `vitest list` imports
 * every test file and reports its cases without executing any of them, so it is fast and does not
 * need the RTDB emulator that `database-rules.test.ts` boots in a `beforeAll`.
 *
 * THE SPAWN MUST HAPPEN INSIDE THE `it`, NOT IN THE `describe` BODY. A `describe` callback runs
 * during collection, so `vitest list` — which collects this file too — would re-enter this file
 * and spawn another `vitest list`, forever. The first draft did exactly that and hung until it was
 * killed. Reading CLAUDE.md at collection time is fine; only the child process recurses.
 *
 * SCOPE, deliberately: this checks the `tests/...` counts only. The `boardwalk-api/tests/...`
 * counts are checked by that package's own twin of this file, because `boardwalk-api` is outside
 * the npm workspace with its own lockfile and its own CI job — a root `npm ci` does not install
 * it, so a guard here would have to SKIP when it could not collect, and a guard that skips is a
 * guard that reports success by doing nothing. Each package guards what its own CI can see;
 * together they cover the table.
 */

const ROOT = join(import.meta.dirname, '..');

/** Every backticked tests/x.test.ts path followed by a parenthesised count, as CLAUDE.md claims it. */
function claimedCounts(): Map<string, number> {
  const md = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
  const claims = new Map<string, number>();
  // A BARE mention carries no claim and is ignored on purpose: the table names plenty of files
  // without a count, and `tests/economy-parity.test.ts` is discussed in the past tense as a test
  // that was deliberately DELETED. Only a parenthesised number asserts something about today.
  const re = /`(tests\/[A-Za-z0-9._-]+\.test\.ts)` \((\d+)\)/g;
  for (const [, file, count] of md.matchAll(re)) {
    // Both groups are non-optional in the pattern, so a match always has them; `strict` cannot
    // see that, and an assertion here would be a lie the day the pattern grows an optional group.
    if (file === undefined || count === undefined) continue;
    claims.set(file, Number(count));
  }
  return claims;
}

/** What Vitest actually collects, per file, keyed relative to the repo root. */
function actualCounts(): Map<string, number> {
  const raw = execFileSync('npx', ['vitest', 'list', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const counts = new Map<string, number>();
  for (const t of JSON.parse(raw) as { file: string }[]) {
    const rel = t.file.startsWith(ROOT) ? t.file.slice(ROOT.length + 1) : t.file;
    counts.set(rel, (counts.get(rel) ?? 0) + 1);
  }
  return counts;
}

describe("CLAUDE.md's test counts are the real ones", () => {
  it('quotes a count for most of the suite, so this guard is not vacuous', () => {
    // This guard's own failure mode: if the regex stops matching, the check below passes over an
    // empty set and reports success. 20 is well under the ~30 claimed today and far above
    // anything a broken parser would return.
    expect(claimedCounts().size).toBeGreaterThan(20);
  });

  it('quotes the number Vitest actually collects, for every file it names', () => {
    const claims = claimedCounts();
    const actual = actualCounts();
    expect(actual.size).toBeGreaterThan(20);

    // Report EVERY mismatch at once. Fixing these one failed run at a time is how a stale count
    // survives a sweep: you correct the one the runner named and re-read a green board.
    const wrong = [...claims]
      .map(([file, claimed]) => ({ file, claimed, real: actual.get(file) }))
      .filter(({ claimed, real }) => real !== claimed)
      .map(({ file, claimed, real }) =>
        real === undefined
          ? `${file}: CLAUDE.md claims ${claimed}, but Vitest collects no such file`
          : `${file}: CLAUDE.md claims ${claimed}, actual ${real}`
      );

    expect(wrong, `CLAUDE.md's test counts have drifted:\n  ${wrong.join('\n  ')}`).toEqual([]);
  });
});
