import { get, ref, update } from 'firebase/database';
import { DEFAULT_AVATAR, STARTING_BANKROLL_CENTS } from '@/system/profile/defaults';
import type {
  AchievementSet,
  DailyState,
  Equipped,
  GameStat,
  Inventory,
  Profile,
  Stats,
} from '@/system/profile/types';
import { totalPlayed, totalWins } from '@/system/progress/stats';
import { firebaseDb } from '@/system/repo/firebase/app';
import type { ProfileRepo } from '@/system/repo/types';

/**
 * `users/<uid>/profile` — the private record — and `leaderboard/<uid>` — its public
 * projection.
 *
 * WHY TWO NODES FOR ONE THING. `users/` is not world-readable, and it must not be: it is
 * where everything private about a player accumulates. But a leaderboard is world-readable
 * by definition. So the public facts are copied to a second node whose rules pin it to
 * EXACTLY five fields (`$other: { ".validate": false }`) — meaning a field added to the
 * private profile later cannot be leaked here by a writer who forgot this node is public.
 * The server refuses it. This is v1's design and it is the best idea in its data layout.
 */

const PROFILE_NODE = (uid: string) => `users/${uid}/profile`;
const LEADERBOARD_NODE = (uid: string) => `leaderboard/${uid}`;

/**
 * The WIRE shape. Every field optional, and that is not defensive pessimism — it is what
 * Firebase actually returns.
 *
 * RTDB strips empty arrays and empty objects on write, so a field written as `[]` comes
 * back MISSING rather than empty. v1 was bitten by exactly this and left the comment:
 * "Firebase strips empty arrays — a fresh account comes back without `unlocked`, which
 * crashed the profile panel." Records written by an older version are the same problem
 * with a different cause. So the boundary type says "anything might be absent" and
 * `readProfile` is the one place that becomes a `Profile` with no optionals. Type the wire
 * as the domain and the crash moves from here — where it is a defaulted field — to a
 * component, where it is a white screen.
 */
interface ProfileWire {
  name?: unknown;
  avatar?: unknown;
  bankrollCents?: unknown;
  xp?: unknown;
  // Phase 4's four. Each is `unknown` because each is exactly the field RTDB is most likely
  // to hand back in a shape the type does not promise: `stats`/`achievements`/`inventory` are
  // objects that come back MISSING when empty (stripped on write), and a record written by an
  // older version has whatever fields that version had. The readers below turn any of that
  // into a valid domain value.
  stats?: unknown;
  achievements?: unknown;
  inventory?: unknown;
  equipped?: unknown;
  daily?: unknown;
  // No `level`: it is derived from `xp` and never stored. A record written by Phase 2 may
  // still carry one on the wire; `readProfile` simply ignores it, and `$other: false` in
  // database.rules.json refuses a NEW write that includes it. See @/system/profile/xp.
}

const str = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.trim() !== '' ? v : fallback;

/**
 * A number, or the fallback — and `Math.round`, which is where "money is integer cents"
 * is actually enforced rather than merely declared.
 *
 * `database.rules.json` cannot express "integer" (`isNumber()` is all RTDB has), so a
 * fractional cent could physically be stored. Rounding on the way IN means the rest of the
 * app never sees one, and the reason to care is v1's: `setMoney` did `parseInt`, so a
 * blackjack 3:2 natural paying `bet * 2.5` silently truncated the odd chip. Cents make the
 * fraction unrepresentable; this makes a legacy or hand-edited one harmless.
 */
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;

/** A non-negative whole count, or 0. Every stat counter and streak passes through this. */
const count = (v: unknown): number => Math.max(0, num(v, 0));

/** Anything the wire might hand back as an object, as a safe record to iterate. */
const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/**
 * Per-game stats, coerced. RTDB returns a missing node for an empty `{}`, and a hand-edited or
 * older record could carry a malformed entry — so each game's counts are read defensively into
 * whole non-negative numbers rather than trusted. The result satisfies the same invariants
 * `bumpStats` maintains, so nothing downstream can tell a loaded stat from a freshly bumped one.
 */
function readStats(wire: unknown): Stats {
  const out: Record<string, GameStat> = {};
  for (const [gameId, raw] of Object.entries(asRecord(wire))) {
    const s = asRecord(raw);
    out[gameId] = {
      played: count(s.played),
      won: count(s.won),
      lost: count(s.lost),
      pushed: count(s.pushed),
    };
  }
  return out;
}

/** Unlocked achievements: keep only entries whose value is a real timestamp number. */
function readAchievements(wire: unknown): AchievementSet {
  const out: Record<string, number> = {};
  for (const [id, raw] of Object.entries(asRecord(wire))) {
    if (typeof raw === 'number' && Number.isFinite(raw)) out[id] = raw;
  }
  return out;
}

/** Owned cosmetics: the set of ids whose value is `true`. Anything else is not ownership. */
function readInventory(wire: unknown): Inventory {
  const out: Record<string, true> = {};
  for (const [id, raw] of Object.entries(asRecord(wire))) {
    if (raw === true) out[id] = true;
  }
  return out;
}

/**
 * Equipped non-avatar cosmetics — each a non-empty string id, or absent. RTDB strips the empty
 * `{}` a fresh account writes, so a missing node reads back as `{}` (nothing equipped), and the
 * card games fall back to the default back. A field of the wrong type is dropped rather than
 * trusted, the same discipline every other reader here follows.
 */
function readEquipped(wire: unknown): Equipped {
  const e = asRecord(wire);
  const out: { cardback?: string; title?: string } = {};
  if (typeof e.cardback === 'string' && e.cardback !== '') out.cardback = e.cardback;
  if (typeof e.title === 'string' && e.title !== '') out.title = e.title;
  return out;
}

/** The daily clock — two whole non-negative numbers, defaulting to "never claimed". */
function readDaily(wire: unknown): DailyState {
  const d = asRecord(wire);
  return { lastClaimDay: count(d.lastClaimDay), streak: count(d.streak) };
}

/** The one place the wire becomes the domain. */
function readProfile(wire: ProfileWire): Profile {
  return {
    // 'Player' rather than a throw: a record with no name is broken, but refusing to load
    // it strands the account with no way to fix the name. Defaults here are recoverable;
    // a crash is not.
    name: str(wire.name, 'Player'),
    avatar: str(wire.avatar, DEFAULT_AVATAR),
    bankrollCents: Math.max(0, num(wire.bankrollCents, STARTING_BANKROLL_CENTS)),
    xp: Math.max(0, num(wire.xp, 0)),
    stats: readStats(wire.stats),
    achievements: readAchievements(wire.achievements),
    inventory: readInventory(wire.inventory),
    equipped: readEquipped(wire.equipped),
    daily: readDaily(wire.daily),
  };
}

/**
 * The public projection. Its field list is duplicated by `database.rules.json`, and that
 * duplication is the design: this is the writer's opinion of what is public, the rules are
 * the enforcement, and if they ever disagree the SERVER wins and the write fails loudly.
 * A projection built by spreading the profile would silently publish whatever gets added to
 * the private record — which is exactly why Phase 4 adds `wins` by NAME here and by a
 * matching `.validate` in the rules, not by widening a spread.
 *
 * `wins` and `played` are `totalWins`/`totalPlayed(p.stats)` — DERIVED sums, never stored counters.
 * The full `stats` object stays private (it is the whole per-game record); only the two numbers the
 * boards rank by are projected. `played` joins `wins` so the Win Rate board has both halves of the
 * ratio public — the rate itself is derived on read, not projected, the same one-source-of-truth
 * call as deriving `level` from `xp`. Each new projected field is also a new `.validate` line in
 * database.rules.json's `leaderboard` node (its `$other: false` refuses an unlisted one), added in
 * this same commit.
 */
const publicProjection = (p: Profile) => ({
  name: p.name,
  avatar: p.avatar,
  bankrollCents: p.bankrollCents,
  xp: p.xp,
  wins: totalWins(p.stats),
  played: totalPlayed(p.stats),
});

/**
 * The multi-path write both `create` and `save` perform: the private record AND its public
 * projection, in one `update`, so RTDB validates every path before applying any of it. A
 * projection that violates the leaderboard pin therefore cannot leave a private record written
 * and a public one missing — the whole write fails.
 *
 * `update` and not `set`: `set` on `users/<uid>/profile` replaces the node, which is fine here
 * because we always hold the complete domain profile — but scoping the update to these two
 * paths says exactly what it touches and leaves any future sibling of `profile` alone.
 */
function writeBoth(uid: string, profile: Profile): Promise<void> {
  return update(ref(firebaseDb()), {
    [PROFILE_NODE(uid)]: { ...profile },
    [LEADERBOARD_NODE(uid)]: publicProjection(profile),
  });
}

export const firebaseProfileRepo: ProfileRepo = {
  async load(uid): Promise<Profile | null> {
    const snap = await get(ref(firebaseDb(), PROFILE_NODE(uid)));
    // `null` ONLY here, and only on an authoritative "the node is not there". Anything
    // else — offline, permission denied — throws out of `get` and stays thrown. That
    // distinction is what makes the store's self-heal safe: it creates a record when this
    // returns null, and a null that meant "network was down" would overwrite a real
    // account with a fresh $5,000.
    if (!snap.exists()) return null;
    return readProfile(snap.val() as ProfileWire);
  },

  async create(uid, profile): Promise<void> {
    // First write of a fresh record — both nodes at once. See `writeBoth`.
    await writeBoth(uid, profile);
  },

  async save(uid, profile): Promise<void> {
    // The mutation path — Phase 4's whole reason for existing. Every economy write (a bet, a
    // payout, a purchase, a daily claim, an edit) computes the next profile with pure logic
    // and persists the WHOLE thing here. Identical mechanism to `create` on purpose: the
    // private record and its public projection move together or not at all, so a bet that
    // bumps `wins` cannot update the private stat and leave the leaderboard behind — the exact
    // "stat credited without the money, or the money without the stat" split that was v1's.
    await writeBoth(uid, profile);
  },
};
