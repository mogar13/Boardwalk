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
const SRC = join(ROOT, 'src');

/**
 * Fixture paths are relative to `src/`, not to one fixture directory.
 *
 * That indirection buys exactly one thing, and it is the thing Phase 1 needed: the
 * DaisyUI ban is scoped BY PATH (`src/ui` may spell component classes, nothing else
 * may), so proving it requires fixtures on both sides of that line. A single
 * fixture directory can only ever test one side, and the side it tests is the one
 * that passes.
 */
const FIXTURE_DIRS = [
  join(SRC, '__lint_fixtures__'),
  join(SRC, 'ui', '__lint_fixtures__'),
  // Phase 2. The Firebase boundary is scoped by path across THREE zones, not two — the
  // SDK dir, its parent (the composition root), and everywhere else — so proving it needs
  // a fixture in each. A fixture directory per zone is the only way to test a path-scoped
  // rule; anything less tests the side that passes.
  join(SRC, 'system', '__lint_fixtures__'),
  join(SRC, 'system', 'repo', '__lint_fixtures__'),
  join(SRC, 'system', 'repo', 'firebase', '__lint_fixtures__'),
];

/**
 * Fixture keys that are LITERAL paths under `src/` rather than sugar for
 * `src/__lint_fixtures__/<key>`.
 *
 * The bare keys do not care where they live. These do — they exist precisely to sit on a
 * particular side of a path-scoped rule, and a fixture that cannot say where it lives
 * cannot test one.
 */
const LITERAL_PREFIXES = ['ui/', 'system/'];

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
  // The kit's REAL shape, as of Phase 1 — `const { confirm } = useConfirm()` is
  // how a game asks "leave the table?" now. This fixture is why the ban on the
  // global is survivable, so it must keep passing: the day this goes red, every
  // call site of the sanctioned replacement is an error and the rule gets deleted.
  'scoped.ts': `function useConfirm(): { confirm: (m: string) => boolean } {
  return { confirm: (m: string) => m.length > 0 };
}
export function ok(): void {
  const { confirm } = useConfirm();
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

  // ── Phase 1: the DaisyUI ban ───────────────────────────────────────────────
  'daisy-bare.tsx': `export function Bad(): null {
  void (<button className="btn btn-primary">Deal</button>);
  return null;
}`,
  // TIER 1: hyphenated forms are caught in ANY string, not just a className — this
  // is what closes the "build the class list in a const, use it later" hole.
  'daisy-indirect.ts': `export const CLASSES = 'modal-box';`,

  // The exemption, and the reason FIXTURE_DIRS has two entries. Same code as
  // daisy-bare.tsx, different directory, must be silent.
  'ui/__lint_fixtures__/kit-ok.tsx': `export function Kit(): null {
  void (<button className="btn btn-primary">Deal</button>);
  return null;
}`,

  // THE FALSE-POSITIVE PROOF, and the whole reason the rule is scoped the way it
  // is. This is an arcade: 'card' is a DaisyUI component AND a thing a card game
  // says in every other line. A rule that fires here is a rule that gets disabled
  // in week one, and then it guards nothing.
  'daisy-domain-words.ts': `export const kind = 'card';
export const seat = { chat: 'table', stack: 'avatar' };
export function deal(): string { return 'card'; }`,

  // Tailwind's `table`/`filter`/`collapse` are real utilities and must survive...
  'daisy-collision-ok.tsx': `export function Ok(): null {
  void (<div className="table filter collapse" />);
  return null;
}`,
  // ...but their hyphenated DaisyUI forms are unambiguous and must not.
  'daisy-collision-bad.tsx': `export function Bad(): null {
  void (<div className="table-zebra" />);
  return null;
}`,

  'daisy-semantic-ok.tsx': `export function Ok(): null {
  void (<div className="bg-base-200 rounded-box border-bw-line p-4" />);
  return null;
}`,

  // ── Phase 1: semantic tokens only ──────────────────────────────────────────
  'palette-scale.tsx': `export function Bad(): null {
  void (<div className="bg-pink-500" />);
  return null;
}`,
  'palette-absolute.tsx': `export function Bad(): null {
  void (<div className="text-white" />);
  return null;
}`,
  'palette-arbitrary.tsx': `export function Bad(): null {
  void (<div className="bg-[#ff2c86]" />);
  return null;
}`,
  'palette-variant.tsx': `export function Bad(): null {
  void (<div className="hover:bg-red-500" />);
  return null;
}`,
  'palette-style.tsx': `export function Bad(): null {
  void (<div style={{ color: '#ff2c86' }} />);
  return null;
}`,
  // Built through cx()/clsx() — the subtree walk exists for exactly this, since the
  // literal is a call argument rather than the attribute value.
  'palette-nested.tsx': `declare function cx(...p: unknown[]): string;
export function Bad(props: { on: boolean }): null {
  void (<div className={cx('p-2', props.on && 'text-slate-300')} />);
  return null;
}`,

  // NO src/ui EXEMPTION for this rule — the kit may spell 'btn', never '#ff2c86'.
  // If this fixture ever goes green, a second palette has a home.
  'ui/__lint_fixtures__/kit-palette-bad.tsx': `export function Bad(): null {
  void (<div className="bg-[#ff2c86] text-white" />);
  return null;
}`,

  // `neutral` is in BOTH the Tailwind ramp and the DaisyUI token set. The digits
  // are the only thing telling them apart, so this pair is the rule's sharpest
  // edge: get it wrong and the rule bans a token it is supposed to require.
  'palette-neutral-ok.tsx': `export function Ok(): null {
  void (<div className="bg-neutral text-neutral-content" />);
  return null;
}`,
  'palette-neutral-bad.tsx': `export function Bad(): null {
  void (<div className="bg-neutral-500" />);
  return null;
}`,

  'palette-ok.tsx': `export function Ok(): null {
  void (
    <div className="bg-base-200 text-primary-content border-bw-line bg-primary/90 bg-transparent text-current shadow-glow-primary" />
  );
  return null;
}`,

  // ── Phase 2: the Firebase boundary ─────────────────────────────────────────
  // Two bans, three zones. See eslint-rules/no-firebase-imports.mjs.

  // BAN A — the SDK, outside src/system/repo/firebase/.
  'fb-sdk-bad.ts': `import { getDatabase } from 'firebase/database';
export const db = getDatabase;`,
  // The scoped-package spelling. `@firebase/*` is the same SDK wearing its internal
  // package names, and a rule that only knows the friendly one has a door open.
  'fb-sdk-scoped-bad.ts': `import { FirebaseError } from '@firebase/util';
export const E = FirebaseError;`,
  // `export ... from` is an import with a re-export stapled to it — and it is the
  // spelling that would let one file launder the SDK to every other.
  'fb-sdk-reexport-bad.ts': `export { ref } from 'firebase/database';`,
  // The one that does not LOOK like an import, which is exactly why it is listed.
  'fb-sdk-dynamic-bad.ts': `export async function load(): Promise<unknown> {
  return import('firebase/database');
}`,

  // BAN B — the IMPLEMENTATION, outside src/system/repo/.
  // Without this the rule is theatre: a game cannot spell `onValue`, but it can spell
  // `firebaseProfileRepo` and be welded to Firebase just as hard.
  'fb-impl-bad.ts': `import { firebaseProfileRepo } from '@/system/repo/firebase/profileRepo';
export const p = firebaseProfileRepo;`,

  // The sanctioned road: the interface, from the composition root. Must stay silent or
  // every consumer of the data layer is an error and the rule gets deleted.
  'fb-interface-ok.ts': `import { repos } from '@/system/repo';
export const p = repos.profile;`,

  // ZONE: src/system/repo/firebase/ — the ONE place the SDK is allowed. Byte-identical
  // import to fb-sdk-bad.ts. If this and that do not disagree, the rule is not
  // path-scoped at all and one of the two tests is a lie.
  'system/repo/firebase/__lint_fixtures__/sdk-ok.ts': `import { getDatabase } from 'firebase/database';
export const db = getDatabase;`,

  // ZONE: src/system/repo/ — the composition root. May name a concrete repo (that is its
  // entire job) but may NOT touch the SDK itself.
  'system/repo/__lint_fixtures__/impl-ok.ts': `import { firebaseProfileRepo } from '@/system/repo/firebase/profileRepo';
export const p = firebaseProfileRepo;`,
  'system/repo/__lint_fixtures__/sdk-bad.ts': `import { getDatabase } from 'firebase/database';
export const db = getDatabase;`,

  // THE RELATIVE ESCAPE. `src/system/` is one level above the composition root, so this
  // must fire — and note the specifier contains no 'system/repo/firebase' substring. A
  // rule that pattern-matched the string would read this as clean, because from where
  // this file stands it looks it. Only resolving the path catches it. A single `../` is
  // NOT banned by no-restricted-imports (a sibling is a real relationship), so this is a
  // door that is genuinely open unless this rule closes it.
  'system/__lint_fixtures__/relative-escape-bad.ts': `import { firebaseProfileRepo } from '../repo/firebase/profileRepo';
export const p = firebaseProfileRepo;`,
};

/**
 * A fixture key is relative to `src/`, EXCEPT that the bare ones are sugar for
 * `__lint_fixtures__/<key>` — most fixtures do not care where they live, and the ones
 * that do (the src/ui pair, and Phase 2's three Firebase zones) say so explicitly by
 * starting with a LITERAL_PREFIX.
 */
function fixturePath(rel: string): string {
  return LITERAL_PREFIXES.some((p) => rel.startsWith(p))
    ? join(SRC, rel)
    : join(SRC, '__lint_fixtures__', rel);
}

beforeAll(() => {
  for (const [rel, code] of Object.entries(FIXTURES)) {
    const abs = fixturePath(rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, code);
  }
});

afterAll(() => {
  // Always, even on a failed assertion. A fixture left under `src/` is not merely
  // untidy — it is a deliberate lint error and a type error inside the real tree,
  // so it would fail `npm run lint` and `tsc -b` for the next person, on a file
  // they never wrote.
  for (const dir of FIXTURE_DIRS) rmSync(dir, { recursive: true, force: true });
});

/** Lint one fixture with the real config; return the rule ids that fired. */
async function rulesFiredOn(rel: string): Promise<(string | null)[]> {
  const abs = fixturePath(rel);
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

describe('DaisyUI classes are unspellable outside src/ui', () => {
  const RULE = '@boardwalk/no-daisyui-classes';

  it('fires on a bare component class in a className', async () => {
    expect(await rulesFiredOn('daisy-bare.tsx')).toContain(RULE);
  });

  it('fires on a hyphenated class in ANY string, not just a className', async () => {
    // The "build the class list somewhere else" hole. `modal-box` is not a word
    // any game says, so scanning every string here costs no false positives.
    expect(await rulesFiredOn('daisy-indirect.ts')).toContain(RULE);
  });

  it('fires on a hyphenated form of a Tailwind-colliding root', async () => {
    expect(await rulesFiredOn('daisy-collision-bad.tsx')).toContain(RULE);
  });

  it('does NOT fire inside src/ui — the kit is the one place allowed', async () => {
    // Byte-for-byte the same JSX as daisy-bare.tsx. If this and that test do not
    // disagree, the rule is not path-scoped at all and one of them is a lie.
    expect(await rulesFiredOn('ui/__lint_fixtures__/kit-ok.tsx')).not.toContain(RULE);
  });

  it("does NOT fire on 'card' as a game-domain word — this is an ARCADE", async () => {
    // The most important negative in the file. 'card', 'table', 'chat', 'stack'
    // and 'avatar' are DaisyUI components AND ordinary nouns here. A rule that
    // fires on `const kind = 'card'` gets disabled in week one by the first person
    // writing Blackjack, and then it guards nothing at all.
    expect(await rulesFiredOn('daisy-domain-words.ts')).not.toContain(RULE);
  });

  it('does NOT fire on table/filter/collapse — those are Tailwind utilities', async () => {
    expect(await rulesFiredOn('daisy-collision-ok.tsx')).not.toContain(RULE);
  });

  it('does NOT fire on semantic utilities', async () => {
    expect(await rulesFiredOn('daisy-semantic-ok.tsx')).not.toContain(RULE);
  });
});

describe('semantic tokens only — no raw palette anywhere', () => {
  const RULE = '@boardwalk/no-raw-palette';

  it.each([
    ['the Tailwind palette scale', 'palette-scale.tsx'],
    ['absolute white/black', 'palette-absolute.tsx'],
    ['an arbitrary hex value', 'palette-arbitrary.tsx'],
    ['a variant-prefixed palette class', 'palette-variant.tsx'],
    ['a colour literal in style={{}}', 'palette-style.tsx'],
    ['a literal nested inside cx()', 'palette-nested.tsx'],
    ['bg-neutral-500 — the ramp, not the token', 'palette-neutral-bad.tsx'],
  ])('fires on %s', async (_label, fixture) => {
    expect(await rulesFiredOn(fixture)).toContain(RULE);
  });

  it('fires INSIDE src/ui too — the kit gets no exemption from this one', async () => {
    // The asymmetry between the two Phase 1 rules, asserted rather than trusted.
    // src/ui may spell `btn`; it may not spell `#ff2c86`. If this ever goes green,
    // a second palette has somewhere to live and the theme stops being the source
    // of truth the moment someone is in a hurry.
    expect(await rulesFiredOn('ui/__lint_fixtures__/kit-palette-bad.tsx')).toContain(RULE);
  });

  it('does NOT fire on bg-neutral / text-neutral-content — the DaisyUI token', async () => {
    // `neutral` is in both the Tailwind ramp and the DaisyUI token set, so the
    // digits are the entire distinction. Get this wrong and the rule bans a token
    // it is supposed to require — which is a rule that argues with the theme.
    expect(await rulesFiredOn('palette-neutral-ok.tsx')).not.toContain(RULE);
  });

  it('does NOT fire on tokens, opacity modifiers, transparent, or current', async () => {
    expect(await rulesFiredOn('palette-ok.tsx')).not.toContain(RULE);
  });
});

describe('Firebase is unreachable outside src/system/repo/firebase', () => {
  const RULE = '@boardwalk/no-firebase-imports';

  it.each([
    ['a bare firebase/* import', 'fb-sdk-bad.ts'],
    ['the @firebase/* scoped spelling of the same SDK', 'fb-sdk-scoped-bad.ts'],
    ['export ... from — an import with a re-export stapled on', 'fb-sdk-reexport-bad.ts'],
    ['a dynamic import() — the one that does not look like an import', 'fb-sdk-dynamic-bad.ts'],
  ])('fires on %s', async (_label, fixture) => {
    expect(await rulesFiredOn(fixture)).toContain(RULE);
  });

  it('does NOT fire inside src/system/repo/firebase — the one place allowed', async () => {
    // Byte-for-byte the same import as fb-sdk-bad.ts, one directory apart. If this and
    // that test do not disagree, the rule is not path-scoped and one of them is a lie.
    expect(await rulesFiredOn('system/repo/firebase/__lint_fixtures__/sdk-ok.ts')).not.toContain(
      RULE
    );
  });

  it('fires on the SDK even in src/system/repo — the composition root is not exempt', async () => {
    // The asymmetry, asserted rather than trusted: src/system/repo may NAME a concrete
    // repo (that is its whole job) but may not touch the SDK. If this goes green, the two
    // bans have collapsed into one and the seam is a directory rather than a boundary.
    expect(await rulesFiredOn('system/repo/__lint_fixtures__/sdk-bad.ts')).toContain(RULE);
  });

  it('fires on importing the IMPLEMENTATION from outside src/system/repo', async () => {
    // Ban A alone is theatre: a game that cannot spell `onValue` can still spell
    // `firebaseProfileRepo` and be welded to Firebase through a nicer-looking door.
    expect(await rulesFiredOn('fb-impl-bad.ts')).toContain(RULE);
  });

  it('does NOT fire on the composition root naming a concrete repo', async () => {
    expect(await rulesFiredOn('system/repo/__lint_fixtures__/impl-ok.ts')).not.toContain(RULE);
  });

  it('fires on a single-../ relative escape — which a string match would miss', async () => {
    // '../repo/firebase/profileRepo' contains no 'system/repo/firebase' substring, and a
    // single '../' is deliberately allowed by no-restricted-imports (a sibling is a real
    // relationship). So this door is open unless the rule RESOLVES the path rather than
    // pattern-matching the specifier.
    expect(await rulesFiredOn('system/__lint_fixtures__/relative-escape-bad.ts')).toContain(RULE);
  });

  it('does NOT fire on importing the interface from @/system/repo', async () => {
    // The sanctioned road, and the load-bearing negative. Every consumer of the data layer
    // spells this — if it ever goes red, the rule bans the thing it exists to require.
    expect(await rulesFiredOn('fb-interface-ok.ts')).not.toContain(RULE);
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
