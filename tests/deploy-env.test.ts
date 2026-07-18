import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * EVERY RUNTIME FLAG THE APP READS IS ACTUALLY INJECTED BY THE DEPLOY.
 *
 * The hole this closes, found the hard way on 2026-07-18, mid-incident: `VITE_API_ECONOMY` — the
 * Phase-B kill switch — was documented in CLAUDE.md, documented in BACKEND_PLAN.md, read by
 * `src/system/repo/index.ts`, and **wired into nothing**. `.github/workflows/deploy.yml` passes an
 * explicit list of vars to the Build step, and Vite only embeds a `VITE_*` that is actually present
 * in the build environment. So `gh secret set VITE_API_ECONOMY 0` set a secret nobody read, the
 * deploy went green, and the switch did precisely nothing. `VITE_WS_ROOMS`, Phase C's kill switch,
 * had the identical hole.
 *
 * That is this repo's oldest failure mode wearing new clothes — prose that looks like enforcement,
 * unreadable to every static tool here — and it landed on the one control you only ever reach for
 * when production is already on fire. A kill switch that has never been pulled is a hypothesis.
 *
 * So: scan the source for what it READS, scan the workflow for what it INJECTS, and require the
 * first to be a subset of the second. A new flag now fails this test until it is either wired into
 * the deploy or explicitly declared dev-only below, with a reason.
 */

const ROOT = join(__dirname, '..');
const WORKFLOW = join(ROOT, '.github/workflows/deploy.yml');

/**
 * Flags that must NOT be in the production build, each for a stated reason. This list is the
 * escape hatch, and it is deliberately awkward: adding to it is a claim that a var is inert in
 * prod, which someone has to write down and mean.
 */
const DEV_ONLY: Readonly<Record<string, string>> = {
  // Gated by `import.meta.env.DEV` in repo/firebase/app.ts, so it cannot affect a prod build.
  // Injecting it would point production at a localhost emulator — the opposite of the goal.
  VITE_USE_EMULATOR: 'dev-only emulator opt-in, gated by import.meta.env.DEV',
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Every `import.meta.env.VITE_*` the shipped source actually reads. */
function flagsReadBySource(): Set<string> {
  const found = new Set<string>();
  for (const file of sourceFiles(join(ROOT, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) {
      found.add(m[1]!);
    }
  }
  return found;
}

/** Every `VITE_*` the deploy workflow puts into the Build step's environment. */
function flagsInjectedByDeploy(): Set<string> {
  const yaml = readFileSync(WORKFLOW, 'utf8');
  const found = new Set<string>();
  // `VITE_X: ${{ secrets.VITE_X }}` — the only form the workflow uses.
  for (const m of yaml.matchAll(/^\s+(VITE_[A-Z0-9_]+):\s*\$\{\{\s*secrets\./gm)) {
    found.add(m[1]!);
  }
  return found;
}

describe('deploy env wiring', () => {
  it('finds the flags it claims to scan (the scanner is not silently empty)', () => {
    // A test whose scanner matches nothing reports success forever. Anchor both halves on a
    // value we know is there, so a regex that stops matching goes red here first.
    expect(flagsReadBySource().has('VITE_API_BASE_URL')).toBe(true);
    expect(flagsInjectedByDeploy().has('VITE_API_BASE_URL')).toBe(true);
  });

  it('injects every flag the source reads, except the declared dev-only ones', () => {
    const read = flagsReadBySource();
    const injected = flagsInjectedByDeploy();

    const missing = [...read].filter((f) => !injected.has(f) && !(f in DEV_ONLY)).sort();

    expect(
      missing,
      `These VITE_* flags are read by src/ but never injected by .github/workflows/deploy.yml, ` +
        `so they are ALWAYS undefined in production and any secret set for them does nothing:\n` +
        `  ${missing.join(', ')}\n` +
        `Add each to the Build step's env block, or to DEV_ONLY in this file with a reason.`
    ).toEqual([]);
  });

  it('wires both kill switches, by name', () => {
    // Named explicitly rather than left to the general rule: these two are the controls you reach
    // for during a Pi outage or a bad cutover, and a generic assertion would let a refactor that
    // stops READING one of them silently also stop injecting it, with the suite still green.
    const injected = flagsInjectedByDeploy();
    expect(injected.has('VITE_API_ECONOMY')).toBe(true); // Phase B economy → Firebase
    expect(injected.has('VITE_WS_ROOMS')).toBe(true); // Phase C rooms → RTDB
  });

  it('does not inject the dev-only emulator flag into production', () => {
    expect(flagsInjectedByDeploy().has('VITE_USE_EMULATOR')).toBe(false);
  });
});
