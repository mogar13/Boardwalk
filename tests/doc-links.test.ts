/**
 * A LINK TO A PLAN IS A FILENAME, and the only way it goes wrong is naming a file that has moved.
 *
 * This is `tests/game-icons.test.ts` pointed at prose: a string typechecks however wrong it is, so
 * the only thing that catches it is asking the disk. What makes it worth a test rather than a
 * convention is that the failure has a MECHANISM and the mechanism fires repeatedly — a plan is
 * finished, it moves to the done folder, and every reference to it stays where it was. By the time
 * slice 5 of the UNO house rules was done, the Liar's Dice and UNO-pot designs were each dead in
 * four places (CLAUDE.md, two manifests, the schema, the wire protocol) and had been for weeks;
 * writing this guard found four MORE, links between plans that broke when the plan holding them
 * moved a directory deeper. Nobody noticed any of it, because a dead link renders as ordinary text
 * and no compiler reads it.
 *
 * IT SCANS ITSELF, on purpose, and that is why the war story above names no paths. Spelling the
 * dead ones out made this file fail on its own docblock, and the cheap fix — skip the file — is a
 * hole in the one file that must not have one.
 *
 * That is exactly the shape CLAUDE.md's Docs rule is about — *"don't state a present-tense fact
 * unless something fails when it stops being true"* — and the shape its Enforcement section exists
 * to keep honest. Every one of those references is a pointer to the reasoning behind a rule, which
 * is the one thing this repo asks you to read before changing anything; a pointer that lands
 * nowhere is worse than no pointer, because it looks like it worked.
 *
 * SCOPED TO `plans/` DELIBERATELY. A blanket "resolve every link in every markdown file" would have
 * to know about anchors, URLs, image paths and generated files, and a guard with false positives
 * gets deleted. `plans/` is where the failure actually happens and where the reasoning actually
 * lives.
 *
 * THE ONE THING IT MUST NOT FLAG is a path into the OTHER repo. `plans/done/ARCHITECTURE.md` names
 * `../Game-Room/plans/MIGRATION_PLAN.md`, which is correct and will never exist here — The Game
 * Shack is an archive this repo shares no build with. A first pass that matched the `plans/…` tail
 * of that string reported it broken, which is the false positive that would have got this deleted
 * on its first red run.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.claude']);
const READ_EXT = /\.(md|ts|tsx)$/;

/** Every file worth scanning, walked from the repo root. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (READ_EXT.test(entry)) out.push(full);
  }
  return out;
}

/**
 * A repo-root-relative reference to a plan, anywhere in a file — a markdown link target, a docblock
 * mention, a bare path in a comment. The leading `[\w./-]*` is what catches a `../Game-Room/`
 * prefix so it can be REJECTED below rather than silently truncated to a path that looks local.
 */
const PLAN_REF = /[\w./-]*plans\/[\w./-]+\.md/g;

/** A relative markdown link between two files inside `plans/`, e.g. `](UNO_POT.md)`. */
const RELATIVE_LINK = /]\((?!https?:|#)([\w./-]+\.md)(?:#[\w-]*)?\)/g;

interface DeadLink {
  readonly ref: string;
  readonly where: string;
}

describe('links to plans resolve to plans that are there', () => {
  const files = sourceFiles(ROOT);

  it('finds enough to be scanning anything at all', () => {
    // Guard the guard: a walker that silently returned nothing would report success forever, which
    // is this repo's most-repeated test failure mode ("a rule that matches nothing reports success").
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith('CLAUDE.md'))).toBe(true);
    expect(files.some((f) => f.includes('plans/done/'))).toBe(true);
  });

  it('every repo-relative `plans/…md` reference names a file that exists', () => {
    const dead: DeadLink[] = [];
    let checked = 0;
    for (const file of files) {
      for (const match of readFileSync(file, 'utf8').matchAll(PLAN_REF)) {
        const ref = match[0];
        // A path that climbs out of the repo is a reference to the ARCHIVE next door, not to a plan
        // here. It is correct and permanently unresolvable, so it is not this guard's business.
        if (ref.includes('../')) continue;
        checked += 1;
        const from = ref.slice(ref.indexOf('plans/'));
        if (!existsSync(resolve(ROOT, from))) {
          dead.push({ ref: from, where: file.slice(ROOT.length) });
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(
      dead,
      `dead plan links — a finished plan moved to plans/done/ and these did not follow:\n${dead
        .map((d) => `  ${d.ref}  <- ${d.where}`)
        .join('\n')}`
    ).toEqual([]);
  });

  it('every relative link BETWEEN plans resolves from its own directory', () => {
    // The other half, and the half the move itself breaks: a live plan links to a finished sibling
    // through the done folder, and the moment it JOINS that sibling there the same string points a
    // directory too deep. The reverse breaks too — a plan that moves down a level takes its
    // `../CLAUDE.md` with it, and that is now one directory short. Both are dead links a repo-root
    // sweep cannot see, because the text contains no leading `plans/` segment at all.
    const planFiles = files.filter((f) => f.includes(`${ROOT}plans`) && f.endsWith('.md'));
    expect(planFiles.length).toBeGreaterThan(5);

    const dead: DeadLink[] = [];
    let checked = 0;
    for (const file of planFiles) {
      for (const match of readFileSync(file, 'utf8').matchAll(RELATIVE_LINK)) {
        const target = match[1] ?? '';
        checked += 1;
        if (!existsSync(resolve(dirname(file), target))) {
          dead.push({ ref: target, where: file.slice(ROOT.length) });
        }
      }
    }
    expect(checked).toBeGreaterThan(3);
    expect(
      dead,
      `dead relative links between plans:\n${dead
        .map((d) => `  ${d.ref}  <- ${d.where}`)
        .join('\n')}`
    ).toEqual([]);
  });

  it('a finished plan lives in plans/done/, and plans/ holds only live work', () => {
    // The convention this guard exists to serve, stated as an assertion rather than as prose. The
    // top level is for plans somebody is still working from; `ROADMAP.md` and `V1_FEATURE_GAPS.md`
    // are standing references and `DOMINOES_BRIEF.md` is a game nobody has built, so the honest
    // check is the DONE folder — every plan in it must actually be finished, which here means it
    // has stopped being referenced as live work. Kept deliberately loose: the point is that the
    // folder exists and is where finished plans go, not to police what belongs in it.
    const done = readdirSync(join(ROOT, 'plans', 'done')).filter((f) => f.endsWith('.md'));
    expect(done.length).toBeGreaterThan(5);
    expect(done).toContain('UNO_HOUSE_RULES.md');
    expect(existsSync(join(ROOT, 'plans', 'UNO_HOUSE_RULES.md'))).toBe(false);
  });
});
