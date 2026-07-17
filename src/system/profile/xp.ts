/**
 * Level is a function of XP. There is no stored `level`, and that is the design.
 *
 * WHY DERIVE INSTEAD OF STORE. Phase 2 shipped both `xp` and `level` on the profile, and
 * Phase 3 is the first code that reads them — which is exactly when it became clear they
 * are one fact written twice. A stored `level` is a second source of truth for something
 * `xp` already determines, and two sources of truth for one fact is the shape of half the
 * v1 defect table: `loadout.color` written by the hub and read by nothing, `gameId`
 * drifting from `games.json`. The specific failure here is concrete — Phase 4 awards XP,
 * and every award site would have to write BOTH fields, and the one that writes `xp` but
 * forgets `level` (or rounds the curve differently) creates an account whose badge and
 * whose progress bar disagree forever. Deleting the field makes that unspellable: there is
 * nothing to forget to write, because `level` is computed here and nowhere is it stored.
 *
 * This is pure — no React, no Firebase, no DOM — for the same reason `credentials.ts` is:
 * a curve welded to a component is an untestable curve, and an off-by-one at a level
 * boundary is precisely the kind of bug that hides in a component and surfaces as "why did
 * my bar fill to 100% and stay there". tests/xp.test.ts covers the boundaries in
 * milliseconds.
 */

/**
 * XP to advance FROM level L TO level L+1 is `LEVEL_STEP * L`. So level 1→2 costs 500,
 * 2→3 costs 1,000, and each level is a little harder than the last — a linear step, which
 * makes the cumulative curve quadratic.
 *
 * The number is arbitrary in the sense that no XP is awarded yet (Phase 4 owns the award
 * sites), and deliberate in the sense that it is the ONE knob: change it here and every
 * level boundary moves together, because nothing caches a level computed against the old
 * value. That is the whole reason to derive rather than store.
 */
export const LEVEL_STEP = 500;

/**
 * Cumulative XP required to REACH level `level` (i.e. the XP at which that level begins).
 * Level 1 begins at 0. Closed form of the running sum of `LEVEL_STEP * (1 + 2 + … + (L-1))`:
 *
 *   thresholdFor(L) = LEVEL_STEP * (L - 1) * L / 2
 *
 * Integer for every integer L ≥ 1, because `(L-1)*L` is always even.
 */
export function xpThresholdForLevel(level: number): number {
  const l = Math.max(1, Math.floor(level));
  return (LEVEL_STEP * (l - 1) * l) / 2;
}

/**
 * The level a given XP total buys. Always ≥ 1; a negative or non-finite input floors to 1
 * rather than throwing, because this renders in the top bar on every frame and a thrown
 * exception there is a white screen over a bad number.
 *
 * The quadratic has a closed-form inverse, but floating-point `Math.sqrt` is wrong by one
 * exactly at the boundaries that matter (the XP totals that are the threshold for a level).
 * So the closed form is used only as a starting GUESS, then corrected by checking
 * `xpThresholdForLevel` directly — integer comparisons, no float in the decision. The loop
 * runs at most twice.
 */
export function levelFromXp(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 1;

  // Solve LEVEL_STEP * (L-1) * L / 2 <= xp for L. The estimate can be off by one either
  // way from float error; the corrections below make the answer exact.
  let level = Math.floor((1 + Math.sqrt(1 + (8 * xp) / LEVEL_STEP)) / 2);
  if (level < 1) level = 1;

  while (xpThresholdForLevel(level + 1) <= xp) level += 1;
  while (level > 1 && xpThresholdForLevel(level) > xp) level -= 1;

  return level;
}

/**
 * Everything the top bar and the profile page need to draw a progress meter, computed
 * once so a caller cannot pair a level from one XP total with a bar from another.
 *
 *   level  — the current level (from `levelFromXp`)
 *   into   — XP earned INTO the current level (0 at the moment of level-up)
 *   needed — XP the current level costs in total (`LEVEL_STEP * level`)
 *   pct    — `into / needed`, clamped to 0..1, for a bar width
 */
export interface XpProgress {
  readonly level: number;
  readonly into: number;
  readonly needed: number;
  readonly pct: number;
}

export function xpProgress(xp: number): XpProgress {
  const safeXp = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  const level = levelFromXp(safeXp);
  const start = xpThresholdForLevel(level);
  const needed = LEVEL_STEP * level;
  const into = safeXp - start;
  return { level, into, needed, pct: Math.min(1, Math.max(0, into / needed)) };
}
