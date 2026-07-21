/**
 * The referee's money rules — PURE. No database, no express, no clock: every function here takes
 * its inputs and returns a decision, so the routes are thin and the rules are testable to the
 * cent.
 *
 * THIS FILE IS NO LONGER A SECOND COPY (Phase D).
 *
 * It used to be. Until Phase D it carried its own `STARTING_BANKROLL_CENTS`, `XP_BY_OUTCOME`,
 * `DAILY_REWARDS_CENTS` and a hand-maintained `PRICES_CENTS` table, and
 * `tests/economy-parity.test.ts` in the frontend suite asserted the two sides agreed. That guard
 * was real — it caught live drift more than once, including P4's new card backs landing on the
 * client only, which would have made the server refuse a purchase the store was happily
 * offering. But a guarded duplication is still a duplication, and a guard can only ever check
 * the constants somebody remembered to list.
 *
 * So the numbers now come from `@boardwalk/game-logic`, the package BOTH sides import, and the
 * parity test is deleted. Deleting a guard is normally the wrong move; it is right here for the
 * one reason that makes it right: there is nothing left to compare. `PRICES_CENTS` in particular
 * is now DERIVED from the shared `CATALOG` rather than transcribed from it, so an item added on
 * one side cannot be missing on the other — there is no other side.
 *
 * What stays here is what is genuinely the SERVER'S and has no client counterpart: the payout
 * ceiling, and the four `check*` functions that phrase a rule as a decision about a request.
 * They are thin, because the rules they enforce live in the shared package.
 *
 * WHAT THE SERVER OWNS AFTER PHASE D:
 *
 *   ✅ the bankroll        — a derived `SUM(ledger.delta_cents)`; no route accepts a balance
 *   ✅ bet legality        — bounds and affordability, checked against that derived balance
 *   ✅ store prices        — derived from the shared catalogue; a client cannot name its own
 *   ✅ the daily clock     — server time, server streak, shared ladder
 *   ✅ XP and stats        — computed here from the outcome, never accepted from the wire
 *   ✅ achievements        — recomputed from server-owned state (see `domain/achievements.ts`);
 *                            a chain badge and its earn-only grant can no longer be forged
 *   ✅ the payout AMOUNT for blackjack — the server deals the hand and settles it
 *                            (see `domain/blackjack.ts`); `payoutCents` is not on that wire
 *
 *   ⚠️ The other four games do not bet, so their only honest payout is 0 and `checkSettle`'s
 *      zero-wager branch enforces it — but their OUTCOME is still self-reported. Making chess or
 *      uno server-authoritative means the server holding the match, which is the rooms half of
 *      Phase D and is NOT done. What a dishonest client can still take there is XP and a stat,
 *      never a chip.
 */
import {
  CATALOG,
  DAILY_REWARDS_CENTS,
  DAY_MS,
  PACKS,
  REFILL_FLOOR_CENTS,
  STARTING_BANKROLL_CENTS,
  XP_BY_OUTCOME,
  claimDaily,
  cosmeticById,
  dustFor,
  packById,
  packPool,
  refillGrantFor,
  type DailyState,
  type Outcome,
  type Pack,
  type PackableCosmetic,
  type Rarity,
} from '@boardwalk/game-logic';

export { DAILY_REWARDS_CENTS, DAY_MS, REFILL_FLOOR_CENTS, STARTING_BANKROLL_CENTS, XP_BY_OUTCOME };
export type { DailyState, Outcome };

/**
 * The store as the server prices it: id → cents, `null` meaning EARN-ONLY (unbuyable at any
 * balance — the achievement pipeline grants it, it is never sold). A `0` is a free starter.
 *
 * DERIVED, not transcribed. This is the shared package's whole point in one expression: the
 * table that used to be maintained by hand alongside `CATALOG` is built from it, so "an item
 * priced on one side and not the other" has stopped being a state the system can be in.
 */
export const PRICES_CENTS: Readonly<Record<string, number | null>> = Object.freeze(
  Object.fromEntries(CATALOG.map((item) => [item.id, item.priceCents]))
);

/**
 * The most a game can EVER return on a wager, as a multiple of the stake, gross.
 *
 * This is a BACKSTOP now rather than blackjack's primary defence — the server deals and settles
 * that game itself (`domain/blackjack.ts`) and computes the payout from its own hand, never from
 * a client number. The ceiling still stands guard over the generic `/settle` path, which exists
 * for the games the server does not deal.
 *
 * The default is deliberately loose (3×) because a ceiling that is too tight silently refuses
 * legitimate wins, which is a worse failure than one that is too loose: a loose ceiling still
 * kills "pay me a million on a $1 bet", which is the attack.
 */
export const PAYOUT_MULTIPLE: Readonly<Record<string, number>> = {
  blackjack: 2.5,
};
export const DEFAULT_PAYOUT_MULTIPLE = 3;

export function payoutCeiling(gameId: string, wagerCents: number): number {
  const multiple = PAYOUT_MULTIPLE[gameId] ?? DEFAULT_PAYOUT_MULTIPLE;
  return Math.floor(wagerCents * multiple);
}

/** A refusal carries a reason the client can render; an acceptance carries the computed numbers. */
export type Decision<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

const refuse = <T>(error: string): Decision<T> => ({ ok: false, error });
const accept = <T>(value: T): Decision<T> => ({ ok: true, value });

/**
 * Is this bet legal against the balance the LEDGER says the player has?
 *
 * The client checks the same thing before staging a chip (`validateBet` — now literally the same
 * package), and that check is for feel: instant feedback, no round-trip. This one decides.
 *
 * The game's `min`/`max` come from a manifest that lives in the frontend, so they arrive on the
 * wire and are NOT trusted as a lower bound on the real check: whatever bounds are claimed, the
 * bet must still be a positive integer the balance covers. A lying client can only tighten its
 * own table, never mint money.
 */
export interface BetRequest {
  readonly amountCents: number;
  readonly balanceCents: number;
}

export function checkBet(req: BetRequest): Decision<{ readonly amountCents: number }> {
  const amount = Math.round(req.amountCents);
  if (!Number.isFinite(amount)) return refuse('bet must be a number');
  if (!Number.isSafeInteger(amount)) return refuse('bet must be a whole number of cents');
  if (amount <= 0) return refuse('bet must be positive');
  if (amount > req.balanceCents) return refuse('insufficient funds');
  return accept({ amountCents: amount });
}

/**
 * Is this settle legal? `openWagerCents` is the stake the server has on record for the wager the
 * client named — `null` when there is no such open wager, which is a refusal and not a 0.
 *
 * The zero-wager case is the non-betting games (chess, solitaire, uno, tic-tac-toe): they report
 * an outcome to earn XP and a stat, and their payout must be exactly 0. Letting a zero-stake
 * settle pay anything is a mint, and it is the shape a "just report a win" call would take.
 */
export interface SettleRequest {
  readonly gameId: string;
  readonly payoutCents: number;
  readonly openWagerCents: number | null;
}

/**
 * Games the SERVER deals, and which therefore may not be settled through this route at all.
 *
 * Without this, Phase D is opt-in rather than enforced, and the bypass is trivial: `POST /bet`
 * then `POST /settle` with `gameId: 'blackjack'` and a payout at the 2.5× ceiling takes the
 * maximum on every hand while never touching `/blackjack/deal`. Closing the old road is the half
 * of a cutover that is easy to forget, because the new road works perfectly without it.
 *
 * A game earns a place on this list the moment the referee can deal it — not before, or a live
 * client is refused mid-hand with nowhere to go.
 *
 * PHASE E adds `liars-dice`, and the argument is the same one a second time: the referee holds
 * every cup and pays the pot, so a `/settle` naming this game is by definition a claim about a
 * match the server already settled itself. Leaving it open would let a client bet a chip and then
 * claim the 3× default ceiling on a match it never played.
 */
export const SERVER_DEALT_GAMES: ReadonlySet<string> = new Set(['blackjack', 'liars-dice']);

export function checkSettle(req: SettleRequest): Decision<{ readonly payoutCents: number }> {
  if (SERVER_DEALT_GAMES.has(req.gameId)) {
    return refuse(`${req.gameId} is settled by the dealer, not by a claim`);
  }

  const payout = Math.round(req.payoutCents);
  if (!Number.isSafeInteger(payout)) return refuse('payout must be a whole number of cents');
  if (payout < 0) return refuse('payout cannot be negative');

  if (req.openWagerCents === null) {
    // No stake on record. The only honest settlement is a free one.
    if (payout !== 0) return refuse('payout with no open wager');
    return accept({ payoutCents: 0 });
  }

  const ceiling = payoutCeiling(req.gameId, req.openWagerCents);
  if (payout > ceiling) return refuse(`payout exceeds the ceiling for ${req.gameId}`);
  return accept({ payoutCents: payout });
}

/**
 * Can this item be bought, at the server's price, with the ledger's balance?
 *
 * Three refusals, and the middle one is the interesting one: an EARN-ONLY item is unbuyable at
 * ANY balance. The frontend refuses to render a buy button for it; this refuses to honour one
 * that was fabricated, which is the difference between a UI rule and a rule.
 *
 * The price comes from `cosmeticById` — the shared catalogue, the same row the store card
 * rendered its price from.
 */
export interface PurchaseRequest {
  readonly itemId: string;
  readonly balanceCents: number;
  readonly owned: boolean;
}

export function checkPurchase(req: PurchaseRequest): Decision<{ readonly priceCents: number }> {
  const item = cosmeticById(req.itemId);
  if (item === undefined) return refuse('no such item');
  if (item.priceCents === null) return refuse('that item cannot be bought — it is earned');
  if (req.owned) return refuse('already owned');
  if (item.priceCents > req.balanceCents) return refuse('insufficient funds');
  return accept({ priceCents: item.priceCents });
}

/** UTC day index. Equal indices are the same day — the whole trick, from the shared module. */
export function dayIndex(nowMs: number): number {
  return Math.floor(nowMs / DAY_MS);
}

/**
 * Claim today's reward against SERVER time, or refuse.
 *
 * The streak arithmetic and the ladder are the shared `claimDaily` — the same function the
 * client's card calls to render "claiming now gives you $1,500". What is server-only is WHOSE
 * CLOCK: the route passes its own `Date.now()` and the request has no time field at all, so
 * winding a device's clock back buys exactly nothing. That is the single cheapest cheat in a
 * client-authoritative economy, and this closes it by omission rather than by validation.
 */
export function checkDaily(
  state: DailyState,
  nowMs: number
): Decision<{ readonly state: DailyState; readonly rewardCents: number }> {
  const claimed = claimDaily(state, nowMs);
  if (claimed === null) return refuse('already claimed today');
  return accept(claimed);
}

/**
 * THE BANKRUPT REFILL — the lifeline, decided here (V1_FEATURE_GAPS.md #10).
 *
 * The SIZE of the grant is not this function's to decide: it is the shared `refillGrantFor`, the
 * same one the hub card renders from, so "how much" cannot mean two things. What is decided here
 * is the two questions that need the server's own state and could not be asked on a client:
 *
 *   • are you actually broke — against the LEDGER balance, not the number a client is holding;
 *   • have you already had one TODAY — against the server's clock and the server's ledger.
 *
 * THE DAILY LIMIT IS DERIVED, NOT STORED, and that is the same argument the bankroll makes two
 * sections up. `todaysRefills` is a COUNT over the ledger rows this feature itself writes, so
 * there is no `last_refill_day` column to add, no migration to deploy, and — more to the point —
 * no second fact that can drift from the money. A stored day index and a ledger row are two
 * records of one event, and the write that lands one without the other is v1's `recordWin` defect
 * with a fresh place to happen.
 *
 * WHY THERE IS A DAILY LIMIT AT ALL, since a top-up can never leave anyone above the floor: without
 * one, a player has an UNLIMITED supply of $200 lottery tickets — top up, stake it all on one hand,
 * and repeat on a loss. Each ticket is negative expectation, but variance is unbounded when the
 * attempts are, and the Richest board would eventually rank whoever ground the most refills. One a
 * day makes the lifeline a lifeline.
 */
export interface RefillRequest {
  readonly balanceCents: number;
  /** How many refills the ledger already records for this player TODAY, server-side. */
  readonly refillsToday: number;
}

/** At most one top-up per UTC day. The same day index the daily reward uses — one clock, not two. */
export const REFILLS_PER_DAY = 1;

export function checkRefill(req: RefillRequest): Decision<{ readonly grantCents: number }> {
  if (req.refillsToday >= REFILLS_PER_DAY) {
    return refuse('you have already topped up today — come back tomorrow');
  }
  const grant = refillGrantFor(req.balanceCents);
  // Not broke. A refusal rather than a 0-cent grant, so the route cannot bank an empty ledger row
  // and burn the player's one top-up for the day on nothing.
  if (grant === null) return refuse('a top-up is only for a bankroll that has run out');
  return accept({ grantCents: grant });
}

/* ----------------------------------------------------------------- packs */

/**
 * PACKS — the server's half, and note how little of it there is.
 *
 * The pack list, the pool, the published odds and the dust curve are NOT here: they are
 * `@boardwalk/game-logic`'s `PACKS`/`packPool`/`dustFor`, the same module the store card renders
 * from. That is the Phase D shape, and packs are the case that most needed it — the card
 * publishes an odds table and the referee rolls against one, and if those were two hand-copied
 * tables the advertised rate could quietly stop being the real rate. They cannot diverge, because
 * there is one of them.
 *
 * What lives here is what is genuinely the SERVER'S and has no client counterpart: the decision
 * about a request (`checkPack`) and THE ROLL ITSELF (`rollPack`). The roll is the whole reason
 * `POST /pack` exists — a client that rolls its own pull picks its own legendary, so the outcome
 * has to be decided somewhere the player cannot reach.
 *
 * The ethics guardrail from the shared module holds where the money actually moves: packs are
 * bought with PLAY MONEY ONLY, the odds are published, and there is no real-money path.
 */

/** The rarities, in ladder order. The odds tables are keyed by exactly this set. */
export const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];

export interface PackRequest {
  readonly packId: string;
  readonly balanceCents: number;
  readonly ownedIds: ReadonlySet<string>;
}

/**
 * May this pack be opened, at the server's price, against the LEDGER'S balance? Mirrors the
 * shared `canOpen` refusal-for-refusal — unknown pack, empty pool, a COMPLETED pool (that is a
 * fee, not a gamble) and a short balance — but decides it against the balance the ledger says
 * you have rather than the one the client is holding.
 */
export function checkPack(req: PackRequest): Decision<{ readonly pack: Pack }> {
  const pack = packById(req.packId);
  if (pack === undefined) return refuse('no such pack');
  const pool = packPool(pack);
  if (pool.length === 0) return refuse('nothing in this pack yet');
  if (pool.every((c) => req.ownedIds.has(c.id))) {
    return refuse('you already own everything in this pack');
  }
  if (pack.priceCents > req.balanceCents) return refuse('insufficient funds');
  return accept({ pack });
}

/** What fell out. The id, not the cosmetic — names and emoji are the frontend's to render. */
export interface PackPull {
  readonly itemId: string;
  readonly duplicate: boolean;
  /** The refund on a duplicate, integer cents. 0 on a fresh pull. */
  readonly dustCents: number;
}

function poolAtRarity(pack: Pack, rarity: Rarity): readonly PackableCosmetic[] {
  return packPool(pack).filter((c) => c.rarity === rarity);
}

/**
 * The published odds restricted to rarities the pool can actually serve, renormalised to sum to
 * 1 — the shared `openPack`'s rule, for the same reason: a weight over an empty bucket would need
 * a silent fallback, and a silent fallback is how a published rate stops being the real rate.
 */
function rarityWeights(pack: Pack): readonly (readonly [Rarity, number])[] {
  const present = RARITIES.filter(
    (r) => pack.odds[r] > 0 && poolAtRarity(pack, r).length > 0
  ).map((r) => [r, pack.odds[r]] as const);
  const total = present.reduce((sum, [, w]) => sum + w, 0);
  if (total === 0) return [];
  return present.map(([r, w]) => [r, w / total] as const);
}

/**
 * How much of this pack's pool this player owns, 0..1 — derived from the inventory, exactly like
 * the shared `completion`, but reading the SERVER'S inventory rather than a profile object.
 */
export function completionOf(pack: Pack, ownedIds: ReadonlySet<string>): number {
  const pool = packPool(pack);
  if (pool.length === 0) return 1;
  return pool.filter((c) => ownedIds.has(c.id)).length / pool.length;
}

/**
 * Roll a pull. PURE — the randomness arrives as an argument, so the odds are unit-testable to the
 * thousandth rather than something you confirm by clicking Open a hundred times. The caller
 * supplies the real generator; the tests supply a scripted one.
 *
 * Two draws, in the shared `openPack`'s order: the rarity against the published (renormalised)
 * weights, then an item uniformly within that rarity. Uniform-within-rarity is the honest reading
 * of "rarity drives the odds" — the tier is the scarce thing, not the individual item — and the
 * roll does NOT steer toward what you are missing, which is what keeps duplicates (and therefore
 * dust) a real outcome rather than dead code.
 *
 * Returns `null` only when the pool cannot serve anything, which `checkPack` refuses first.
 */
export function rollPack(
  pack: Pack,
  ownedIds: ReadonlySet<string>,
  rand: () => number
): PackPull | null {
  const weights = rarityWeights(pack);
  const last = weights[weights.length - 1];
  if (last === undefined) return null;

  // Walk the cumulative weights. The trailing `last` covers the float-rounding case where the sum
  // lands a hair under 1 — it can only ever land on a rarity that HAS a bucket.
  const r = rand();
  let acc = 0;
  let rarity: Rarity = last[0];
  for (const [tier, w] of weights) {
    acc += w;
    if (r < acc) {
      rarity = tier;
      break;
    }
  }

  const bucket = poolAtRarity(pack, rarity);
  // `min` clamps the one-in-4-billion case where the generator returns exactly 1.
  const item = bucket[Math.min(bucket.length - 1, Math.floor(rand() * bucket.length))];
  if (item === undefined) return null;

  if (ownedIds.has(item.id)) {
    // Completion is read BEFORE the open — a duplicate does not change the collection, and
    // reading it up front keeps "what the card quoted" and "what you got" the same number.
    return {
      itemId: item.id,
      duplicate: true,
      dustCents: dustFor(pack, item.rarity, completionOf(pack, ownedIds)),
    };
  }
  return { itemId: item.id, duplicate: false, dustCents: 0 };
}

export { PACKS, packById, packPool, dustFor };
