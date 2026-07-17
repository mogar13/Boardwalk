// A structural guard: no new god-components, and any existing one may only shrink.
//
// WHY THIS EXISTS, HERE, IN PHASE 0. It is ported from VS-Dashboard, where it was
// written too late: AdminPage.tsx had already reached 2,621 lines and 107 useState
// hooks, so the guard's whole job was fencing debt that already existed. Its
// baseline still lists nine files, one of them 2,586 lines.
//
// The Boardwalk has no such file yet, and this guard is the reason it never gets
// one. Starting it at zero inverts the tool: over there it is a ratchet on debt,
// here it is a ceiling that has never been crossed. `scripts/file-size-baseline.json`
// is `{}` and the correct number of entries it will ever hold is zero.
//
// It is deliberately NOT a `max-lines` warning. A warning that fires and fixes
// nothing is noise, and noise gets muted. This FAILS:
//
//   • Any file (not in the baseline) at or over CEILING fails immediately.
//   • Any baselined file that GREW fails. Shrinking it is the only allowed move.
//   • A baselined file that shrank is reported, not failed — re-lock it with
//     `--init` and the ratchet tightens.
//
// Why the ceiling is real and not a vibe: v1's `system_ui.js` is 1,095 lines, of
// which ~430 are dead — a 258-line fossil copy of `system_lobby.js` and a 131-line
// divergent copy of `system_chat.js`, both overwritten at load. Nobody added 430
// dead lines on purpose. They accreted, in a file nobody could hold in their head.
//
// FALSIFY IT: tests/file-size-guard.test.ts builds a throwaway git repo, copies
// THIS file into it, and asserts it goes red on a born-too-big file and on a
// baselined file that grew. A guard that cannot be shown to fail is not a guard.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(ROOT, 'scripts', 'file-size-baseline.json');

// "One screen's worth of one responsibility." A soft target, not a truth — but a
// soft target that fails the build is worth more than a hard truth that doesn't.
const CEILING = 800;

// Source we own. Tests and fixtures are excluded: a test is allowed to be long,
// and a table-driven test of every legal chess move SHOULD be.
const AREAS = ['src/', 'packages/', 'scripts/'];
const EXTS = ['.ts', '.tsx', '.js', '.mjs'];

// Enumerate TRACKED files via git — it already honours .gitignore, so node_modules/
// and dist/ are excluded for free and cannot drift from what the build sees.
// Brace/`**` globs are not git pathspec, so filter in JS.
function sourceFiles() {
  const out = execSync(`git -C "${ROOT}" ls-files`, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((f) => AREAS.some((a) => f.startsWith(a)))
    .filter((f) => EXTS.some((e) => f.endsWith(e)))
    .filter((f) => !/(^|\/)(tests?|__tests__)\//.test(f))
    .filter((f) => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(f));
}

function lineCount(file) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  if (text === '') return 0;
  // Match `wc -l` semantics closely enough for a stable, reproducible number.
  const n = text.split('\n').length;
  return text.endsWith('\n') ? n - 1 : n;
}

function measure() {
  const counts = {};
  for (const f of sourceFiles()) counts[f] = lineCount(f);
  return counts;
}

const counts = measure();
const init = process.argv.includes('--init');

if (init) {
  const baseline = {};
  for (const [f, n] of Object.entries(counts).sort()) {
    if (n >= CEILING) baseline[f] = n;
  }
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`Wrote baseline: ${Object.keys(baseline).length} files at or over ${CEILING} lines.`);
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  console.error(
    `No baseline at ${relative(ROOT, BASELINE_PATH)}. Create it once with: npm run guard:filesize -- --init`
  );
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));

const grew = []; // a baselined file got bigger — the debt is going the wrong way
const born = []; // a brand-new file was born over the ceiling
const shrank = []; // a baselined file got smaller — re-baseline to lock it in

for (const [f, n] of Object.entries(counts)) {
  if (f in baseline) {
    if (n > baseline[f]) grew.push([f, baseline[f], n]);
    else if (n < baseline[f]) shrank.push([f, baseline[f], n]);
  } else if (n >= CEILING) {
    born.push([f, n]);
  }
}

let failed = false;

if (born.length) {
  failed = true;
  console.error(`\n✗ New file(s) born over the ${CEILING}-line ceiling — split before landing:`);
  for (const [f, n] of born.sort((a, b) => b[1] - a[1])) console.error(`    ${n}\t${f}`);
}

if (grew.length) {
  failed = true;
  console.error(`\n✗ God-component(s) growing (only shrinking is allowed):`);
  for (const [f, was, now] of grew.sort((a, b) => b[2] - a[2])) {
    console.error(`    ${was} → ${now}\t${f}`);
  }
}

if (shrank.length) {
  console.log(
    `\n✓ Shrank since baseline — re-lock the ratchet with \`npm run guard:filesize -- --init\`:`
  );
  for (const [f, was, now] of shrank.sort((a, b) => a[2] - b[2])) {
    console.log(`    ${was} → ${now}\t${f}`);
  }
}

if (failed) {
  console.error('');
  process.exit(1);
}

console.log(
  `✓ File-size guard: no new god-components, none grew (${Object.keys(baseline).length} fenced, ceiling ${CEILING}).`
);
