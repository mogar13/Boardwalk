import type { Profile } from '@/system/profile/types';

/**
 * The Phase-A shadow diff — pure, so it is unit-testable and could run server-side too.
 *
 * Shadow mode (BACKEND_PLAN.md Phase A) keeps Firebase as the source of truth and mirrors every
 * profile write to `boardwalk-api`, then reads the record back and compares it to what was just
 * written. This module is that comparison. The deliverable of the whole phase is "the diff is
 * empty for a week of real play"; this function is what produces the diff, and a NON-empty result
 * is the disagreement the client logs. No DOM, no React, no Firebase — the same purity the
 * `logic/` folders keep, for the same reason.
 *
 * WHY A FIELD-PATH LIST AND NOT A BOOLEAN. "They disagree" is useless in a console at 2am; "the
 * server read back `stats.blackjack.won = 3` where we wrote `4`" points straight at the bug. The
 * server round-trips a `Profile` identically by construction (it derives the bankroll from the
 * ledger but appends the delta on save, so a PUT-then-GET returns exactly what was written), so a
 * clean run really is an empty array — any entry is a real divergence worth reading.
 */

export interface ProfileDiff {
  /** Dotted path to the field that disagreed, e.g. `stats.blackjack.won` or `daily.streak`. */
  readonly path: string;
  /** What the client wrote (and Firebase holds). */
  readonly expected: unknown;
  /** What the API read back. `undefined` when the field is absent on the server side. */
  readonly actual: unknown;
}

const push = (out: ProfileDiff[], path: string, expected: unknown, actual: unknown): void => {
  if (expected !== actual) out.push({ path, expected, actual });
};

/** Union of both sides' keys, so a field present on only one side is still compared (and diffs). */
const keysOf = (a: object, b: object): string[] => [
  ...new Set([...Object.keys(a), ...Object.keys(b)]),
];

const rec = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/**
 * Compare the profile the client wrote against the one the API read back.
 *
 * `actual === null` is its own single diff — the server has no record where the client expects one,
 * which is the loudest possible disagreement and worth surfacing whole rather than as a field storm.
 * Everything else is compared field by field, nested records (`stats`, `achievements`, `inventory`,
 * `daily`) included, so the returned paths read like the shape they came from.
 */
export function diffProfiles(expected: Profile, actual: Profile | null): ProfileDiff[] {
  if (actual === null) {
    return [{ path: '(profile)', expected: 'present', actual: 'absent' }];
  }

  const out: ProfileDiff[] = [];

  push(out, 'name', expected.name, actual.name);
  push(out, 'avatar', expected.avatar, actual.avatar);
  push(out, 'bankrollCents', expected.bankrollCents, actual.bankrollCents);
  push(out, 'xp', expected.xp, actual.xp);

  // stats: each game's four counts.
  const eStats = rec(expected.stats);
  const aStats = rec(actual.stats);
  for (const game of keysOf(eStats, aStats)) {
    const e = rec(eStats[game]);
    const a = rec(aStats[game]);
    for (const field of ['played', 'won', 'lost', 'pushed']) {
      push(out, `stats.${game}.${field}`, e[field], a[field]);
    }
  }

  // achievements: id -> unlock timestamp.
  const eAch = rec(expected.achievements);
  const aAch = rec(actual.achievements);
  for (const id of keysOf(eAch, aAch)) push(out, `achievements.${id}`, eAch[id], aAch[id]);

  // inventory: owned-id set (`{ id: true }`).
  const eInv = rec(expected.inventory);
  const aInv = rec(actual.inventory);
  for (const id of keysOf(eInv, aInv)) push(out, `inventory.${id}`, eInv[id], aInv[id]);

  // daily: the two-number clock.
  push(out, 'daily.lastClaimDay', expected.daily.lastClaimDay, actual.daily.lastClaimDay);
  push(out, 'daily.streak', expected.daily.streak, actual.daily.streak);

  return out;
}
