import { get, ref, update } from 'firebase/database';
import { DEFAULT_AVATAR, STARTING_BANKROLL_CENTS } from '@/system/profile/defaults';
import type { Profile } from '@/system/profile/types';
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
  level?: unknown;
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
    level: Math.max(1, num(wire.level, 1)),
  };
}

/**
 * The public projection. Its field list is duplicated by `database.rules.json`, and that
 * duplication is the design: this is the writer's opinion of what is public, the rules are
 * the enforcement, and if they ever disagree the SERVER wins and the write fails loudly.
 * A projection built by spreading the profile would silently publish whatever Phase 4 adds
 * to it.
 */
const publicProjection = (p: Profile) => ({
  name: p.name,
  avatar: p.avatar,
  bankrollCents: p.bankrollCents,
  xp: p.xp,
  level: p.level,
});

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
    // ONE multi-path update, not two writes.
    //
    // Both nodes land or neither does — RTDB applies a multi-path update atomically, and
    // it validates every path against the rules first. So a projection that violates
    // `leaderboard`'s pinned field set cannot leave a private record written and a public
    // one missing. v1 did these as two sequential `dbSet`s and could half-land.
    //
    // `update` and not `set`: `set` on `users/<uid>/profile` would be fine today and would
    // silently delete Phase 4's siblings the moment they exist. The path-scoped update
    // says what it touches.
    await update(ref(firebaseDb()), {
      // The private record gets the whole profile; the public one gets the projection.
      // These are byte-identical TODAY, because Phase 2's Profile has exactly the five
      // public fields — which is precisely why writing `publicProjection` to both would
      // pass every test here and leak the first private field Phase 4 adds. The two
      // expressions differ because the two nodes mean different things, not because the
      // values differ yet.
      [PROFILE_NODE(uid)]: { ...profile },
      [LEADERBOARD_NODE(uid)]: publicProjection(profile),
    });
  },
};
