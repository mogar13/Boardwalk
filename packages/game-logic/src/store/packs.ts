/**
 * PACKS — the variable-reward loop (P4 of the progression overhaul), and the one lever the store
 * was missing. Direct purchase is a vending machine: you know what you get, so there is no moment.
 * A pack is a slot machine: chips in, a rarity rolled, a card turned over. Same cosmetics, same
 * economy — the DIFFERENCE IS THE UNCERTAINTY, and that is the whole mechanic.
 *
 * ETHICS GUARDRAIL, STATED IN THE CODE SO NO LATER CHANGE QUIETLY CROSSES IT. Packs are bought
 * with PLAY MONEY ONLY. There is no real-money purchase in this app and there will never be one —
 * not a chip top-up, not a "premium" pack, not a currency that costs a card. The odds are PUBLISHED
 * on the pack card (`Pack.odds` is the same table the roll reads, so the shown odds cannot drift
 * from the real ones). We are copying the fun of opening a pack, not the predatory economics that
 * usually rides with it. If a future change adds a payment path here, it is not a feature, it is a
 * different product.
 *
 * WHY THIS FILE IS PURE AND SEEDED. `openPack(profile, pack, seed)` takes its randomness as an
 * ARGUMENT and never calls `Math.random()` — the same discipline as every `logic/` in the repo.
 * That is what makes "a legendary is rolled at the published rate", "a duplicate refunds dust", and
 * "an earn-only title can never drop" assertions in `tests/packs.test.ts` instead of things found
 * by clicking Open a hundred times. The caller (`useStore`) supplies a nonce.
 *
 * THE TWO INVARIANTS THAT MATTER MOST:
 *   1. A pack NEVER grants an earn-only cosmetic, so the P2/P3 earn-vs-buy split holds — you still
 *      cannot buy your way to "Grandmaster", not even through a slot machine. A pack that could
 *      drop it would quietly undo the whole prestige tier. This one is enforced BY TYPE:
 *      `PackPull.item` is a `PackableCosmetic`, reachable only through `isPackable`.
 *   2. A pack NEVER grants a free starter. Everyone owns those; rolling one would be a guaranteed
 *      dud dressed as a pull. That half is a value check (`> 0`) TypeScript cannot express, so it
 *      stays a test.
 *
 * DUPLICATES ARE REAL, AND THAT IS DELIBERATE. The roll picks uniformly among ALL items of the
 * rolled rarity, owned or not — it does not quietly steer to what you are missing. If it did, the
 * dust refund would be code with no reader (`loadout.color` in mechanic form) and the pull would
 * lose its tension. A duplicate instead converts to DUST, a chip refund that scales BOTH ways: up
 * with the rarity rolled, and up with how much of the pool you already own (`dustFor`). That second
 * axis is the fix for the one place a pack genuinely stung — the window just under a finished pool,
 * where a near-certain duplicate was still costing full price. `canOpen` refuses a COMPLETED pool
 * outright, because that is a fee rather than a gamble; the approach to it is now cushioned instead
 * of cliff-edged, and it needed no stored pity counter to do it.
 */
import { formatDollars } from '../profile/money';
import type { Profile } from '../profile/types';
import {
  CATALOG,
  isOwned,
  type Cosmetic,
  type CosmeticKind,
  type PurchaseCheck,
  type Rarity,
} from './catalog';

/**
 * A pack: a price, the kinds it can draw from, and the published rarity odds. `odds` is a weight
 * per rarity summing to 1 — it is both what the store card displays and what the roll reads, so
 * the advertised rate IS the rate. Weights are renormalised over the rarities actually present in
 * the pool (see `rarityWeights`), so a pack whose pool has no legendary cannot roll a dead branch.
 */
export interface Pack {
  /** Stable id. Packs are consumed, never owned, so this is not an `inventory` key — just a lookup. */
  readonly id: string;
  readonly name: string;
  /** One line of store copy — what is in it and who it is for. */
  readonly blurb: string;
  /** INTEGER CENTS, like every other price in the repo. */
  readonly priceCents: number;
  /** Which cosmetic kinds the pool draws from. */
  readonly kinds: readonly CosmeticKind[];
  /** Published pull rates, summing to 1. Displayed verbatim on the card. */
  readonly odds: Readonly<Record<Rarity, number>>;
}

/**
 * A cosmetic a pack is ALLOWED to contain: bought with chips, `priceCents` a real number.
 *
 * This is the repo's meta-rule applied to the invariant that matters most here — make the wrong
 * thing UNSPELLABLE rather than documenting "don't". `PackPull.item` is a `PackableCosmetic`, so a
 * future change that hand-builds a pull straight out of `CATALOG` does not typecheck: it has to go
 * through `isPackable` first. The tests still assert the runtime half (the `> 0` starter exclusion
 * is a value check TypeScript cannot express), but the earn-only half — the one that would let
 * chips buy "Grandmaster" — is now a compile error rather than a test we have to remember to keep.
 */
export type PackableCosmetic = Cosmetic & { readonly priceCents: number };

/** The narrowing gate. The ONLY way a `Cosmetic` becomes pack-eligible. */
export function isPackable(c: Cosmetic): c is PackableCosmetic {
  return c.priceCents !== null && c.priceCents > 0;
}

/**
 * A duplicate's BASE refund, as a fraction of the PACK price (not the item price) by the rarity
 * rolled. A duplicate legendary refunds the whole pack — the near-miss consolation that keeps the
 * pull from feeling like a mugging, and the reason the roll can afford to be honest about
 * duplicates. The base is the floor; see `dustFor` for why it climbs with your collection.
 */
const DUST_RATE: Readonly<Record<Rarity, number>> = {
  common: 0.1,
  rare: 0.25,
  epic: 0.5,
  legendary: 1,
};

/**
 * The packs on sale. Three tiers of gamble, each priced in the neighbourhood of what its pool is
 * worth on average — a pack is a different WAY to buy, not a discount, or nobody would ever buy
 * an item directly and the store's price ladder would be decoration.
 */
export const PACKS: readonly Pack[] = [
  {
    id: 'pk_backs',
    name: 'Card Back Pack',
    blurb: 'One card back from the whole ladder. The cheapest way onto the table with a new deck.',
    priceCents: 250_000,
    kinds: ['cardback'],
    odds: { common: 0.6, rare: 0.28, epic: 0.1, legendary: 0.02 },
  },
  {
    id: 'pk_avatars',
    name: 'Avatar Pack',
    blurb: 'One face from the paid roster. Whales and clovers are in here somewhere.',
    priceCents: 1_000_000,
    kinds: ['avatar'],
    odds: { common: 0.55, rare: 0.3, epic: 0.12, legendary: 0.03 },
  },
  {
    id: 'pk_grand',
    name: 'The Grand Pack',
    blurb:
      'Anything the store sells — back, face, title, felt or frame — with the house leaning rare. Earn-only titles are not in here, and never will be.',
    priceCents: 2_000_000,
    // P5 widened this to every buyable kind, which is what "The Grand Pack" says on the tin. The
    // pool is derived (`packPool` = CATALOG ∩ isPackable ∩ kinds), so felts and frames joined by
    // being listed HERE — adding them to CATALOG alone changed nothing, which is the property that
    // let P5 decide pack membership deliberately rather than inheriting it. Two knock-ons, both
    // automatic and both correct: `rarityWeights` renormalises over the rarities the wider pool can
    // actually serve (felts have no legendary), and `completion`/`dustFor` recompute off pool size,
    // so an existing collector's completion — and the dust their duplicates refund — drops the day
    // this ships. That is the honest consequence of a bigger pool, not a regression.
    kinds: ['cardback', 'avatar', 'title', 'felt', 'frame'],
    odds: { common: 0.3, rare: 0.38, epic: 0.24, legendary: 0.08 },
  },
];

/** Lookup by id, for turning a clicked card back into a pack. */
export function packById(id: string): Pack | undefined {
  return PACKS.find((p) => p.id === id);
}

/**
 * What a pack can actually drop: cosmetics of its kinds that are BOUGHT with chips —
 * `priceCents > 0`. That single filter enforces both invariants in the header: `null` excludes the
 * earn-only prestige tier, `0` excludes the free starters everyone already owns.
 */
export function packPool(pack: Pack): readonly PackableCosmetic[] {
  return CATALOG.filter(isPackable).filter((c) => pack.kinds.includes(c.kind));
}

/** The pool's items at one rarity — the bucket the second roll indexes into. */
function poolAtRarity(pack: Pack, rarity: Rarity): readonly PackableCosmetic[] {
  return packPool(pack).filter((c) => c.rarity === rarity);
}

/**
 * The odds restricted to rarities the pool can actually serve, renormalised to sum to 1. Without
 * this, a pack listing a legendary weight over a pool with no legendary would roll into an empty
 * bucket — the roll would have to fall back somewhere, and a silent fallback is how a published
 * rate stops being the real rate. Catalogue integrity is asserted in the tests too; this makes the
 * roll total regardless.
 */
function rarityWeights(pack: Pack): readonly (readonly [Rarity, number])[] {
  const present = (Object.keys(pack.odds) as Rarity[])
    .filter((r) => pack.odds[r] > 0 && poolAtRarity(pack, r).length > 0)
    .map((r) => [r, pack.odds[r]] as const);
  const total = present.reduce((sum, [, w]) => sum + w, 0);
  if (total === 0) return [];
  return present.map(([r, w]) => [r, w / total] as const);
}

/**
 * A tiny deterministic PRNG (mulberry32). Not cryptographic and not trying to be — its job is to
 * turn one caller-supplied nonce into a repeatable sequence, which is what makes the roll a unit
 * test. `>>> 0` keeps everything in unsigned 32-bit space so the sequence is identical on every
 * engine rather than drifting with float precision.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What came out of the pack. `duplicate` is the dust path; on a fresh pull `dustCents` is 0. */
export interface PackPull {
  /** Typed as PACKABLE, not `Cosmetic` — an earn-only item cannot be spelled here. See above. */
  readonly item: PackableCosmetic;
  /** Already owned — converted to dust rather than granted twice. */
  readonly duplicate: boolean;
  /** The refund on a duplicate, in integer cents. 0 on a fresh pull. */
  readonly dustCents: number;
}

export interface PackResult {
  /** The new profile — price spent, item granted (or dust credited back). */
  readonly profile: Profile;
  /** What was rolled. `null` only if the pack's pool is empty, which `canOpen` refuses first. */
  readonly pull: PackPull | null;
}

/**
 * May this pack be opened? Values, not exceptions — the card renders the reason under the price.
 * A completed pool is refused BEFORE the money moves: duplicates are the gamble, but a pack that
 * can only ever return dust is not a gamble, it is a fee.
 */
export function canOpen(profile: Profile, pack: Pack): PurchaseCheck {
  const pool = packPool(pack);
  if (pool.length === 0) return { ok: false, error: 'Nothing in this pack yet.' };
  if (pool.every((c) => isOwned(profile, c))) {
    return { ok: false, error: 'You already own everything in this pack.' };
  }
  if (profile.bankrollCents < pack.priceCents) {
    return { ok: false, error: `Costs ${formatDollars(pack.priceCents)}.` };
  }
  return { ok: true };
}

/**
 * Open it. Returns a NEW profile — the caller persists it. Assumes `canOpen` passed (the hook
 * re-checks after the confirm, the same way `buy` does), and floors the bankroll at 0 so a
 * mis-ordered call cannot write a negative the rules would refuse anyway.
 *
 * Two draws off one seeded stream: the rarity (against the published, renormalised weights) and
 * then an item uniformly within that rarity. Uniform-within-rarity is the honest reading of
 * "rarity drives the odds" — the tier is the scarce thing, not the individual item.
 */
export function openPack(profile: Profile, pack: Pack, seed: number): PackResult {
  const weights = rarityWeights(pack);
  const spent = Math.max(0, profile.bankrollCents - pack.priceCents);
  if (weights.length === 0) return { profile, pull: null };

  const next = mulberry32(seed);

  // Roll the rarity: walk the cumulative weights. The final `?? last` covers the float-rounding
  // case where the cumulative sum lands a hair under 1 — it cannot pick a rarity with no bucket.
  const r = next();
  let acc = 0;
  const last = weights[weights.length - 1];
  if (last === undefined) return { profile, pull: null };
  let rarity: Rarity = last[0];
  for (const [tier, w] of weights) {
    acc += w;
    if (r < acc) {
      rarity = tier;
      break;
    }
  }

  // `rarityWeights` only keeps rarities with a non-empty bucket, so the pick below always lands —
  // but it is written to be total anyway rather than asserted non-null. The `min` clamps the
  // one-in-4-billion case where the generator returns exactly 1.
  const bucket = poolAtRarity(pack, rarity);
  const item = bucket[Math.min(bucket.length - 1, Math.floor(next() * bucket.length))];
  if (item === undefined) return { profile, pull: null };

  if (isOwned(profile, item)) {
    // Completion is measured on the profile BEFORE this open — the pull is a duplicate, so it does
    // not change the collection, but reading it up front keeps "what the card promised" and "what
    // you got" the same number.
    const dustCents = dustFor(pack, item.rarity, completion(profile, pack));
    return {
      profile: { ...profile, bankrollCents: spent + dustCents },
      pull: { item, duplicate: true, dustCents },
    };
  }

  return {
    profile: {
      ...profile,
      bankrollCents: spent,
      inventory: { ...profile.inventory, [item.id]: true },
    },
    pull: { item, duplicate: false, dustCents: 0 },
  };
}

/**
 * How much of this pack's pool you already own, 0..1. DERIVED from `inventory` — the same rule that
 * keeps `level` out of the profile and computes it from `xp`. A pity counter would have meant a new
 * stored field, a `$other: false` rules change and a hand deploy; this needs none of that, because
 * "how deep am I in this pool" is already a fact the inventory determines.
 */
export function completion(profile: Profile, pack: Pack): number {
  const pool = packPool(pack);
  if (pool.length === 0) return 1;
  return pool.filter((c) => isOwned(profile, c)).length / pool.length;
}

/**
 * The dust a duplicate refunds — the store card's "duplicates refund" line, and the fix for the
 * one place a pack genuinely stung.
 *
 * THE PROBLEM IT SOLVES. `canOpen` already refuses a COMPLETED pool, but the window just below that
 * was the bad one: at 13-of-14 backs collected you were paying full price for a near-certain
 * minimum-rate dust. The gamble stops being a gamble long before the pool is finished.
 *
 * THE FIX. Dust rises with your completion of the pool, from the rarity's base rate at an empty
 * collection toward a FULL refund as the pool fills:
 *
 *     rate = base + (1 - base) × completion
 *
 * Monotonic, never above 1 (so a duplicate can never profit — still asserted), and it needs no
 * stored state at all. The effect is that the deeper you are in a pool, the less a duplicate costs
 * you, which is the same relief a pity timer buys without the migration surface. Rarity still
 * matters: a legendary duplicate refunds everything at any completion.
 */
export function dustFor(pack: Pack, rarity: Rarity, completionPct = 0): number {
  const base = DUST_RATE[rarity];
  const rate = base + (1 - base) * Math.min(1, Math.max(0, completionPct));
  return Math.floor(pack.priceCents * rate);
}
