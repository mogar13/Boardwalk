/**
 * The referee's money rules — PURE. No database, no express, no clock: every function here takes
 * its inputs and returns a decision, so the routes are thin and the rules are testable to the
 * cent.
 *
 * WHY THIS FILE IS A SECOND COPY, AND WHY THAT IS NOT THE DUPLICATION IT LOOKS LIKE.
 *
 * The frontend already has these rules, pure, in `src/system/economy/bet.ts`,
 * `src/system/store/catalog.ts` and `src/system/rewards/daily.ts`. Sharing them is the right end
 * state and it is exactly what BACKEND_PLAN.md's Phase D describes — `packages/game-logic`, one
 * module imported by both sides. Phase B does not do that move, for one concrete reason: the
 * frontend is ESM built by Vite, this service is CommonJS compiled by `tsc` with `rootDir: src`,
 * and `boardwalk-api` is not in the root npm workspace. Wiring a shared package across that seam
 * changes the API's build output layout and therefore the Pi's systemd entrypoint — a
 * deploy-coupled change, made blind, in the same commit that moves the source of truth for money.
 * That is two risky things at once.
 *
 * So the copy is deliberate AND IT IS GUARDED: `tests/economy-parity.test.ts` in the FRONTEND
 * suite imports this file and the frontend's originals and asserts they agree — every price, the
 * daily ladder, the XP table, over the whole catalogue. A drift is red, not silent. That is the
 * repo's standing rule (CLAUDE.md: "A convention is only real if something red happens when it's
 * broken"), applied to a duplication instead of a doc.
 *
 * WHAT THE SERVER OWNS AFTER PHASE B, stated honestly:
 *
 *   ✅ the bankroll        — a derived `SUM(ledger.delta_cents)`; no route accepts a balance
 *   ✅ bet legality        — bounds and affordability, checked against that derived balance
 *   ✅ the payout CEILING  — a settle must consume a real open wager, capped per game
 *   ✅ store prices        — the server owns the catalogue; the client cannot name its own price
 *   ✅ the daily clock     — server time, server streak; a wound-back client clock buys nothing
 *   ✅ XP and stats        — computed here from the outcome, never accepted from the wire
 *
 *   ⚠️ the payout AMOUNT within that ceiling is still the client's claim, because the server does
 *      not yet run the game's rules. That is Phase D and it is not smuggled in here.
 *   ⚠️ achievements (and the cosmetics they grant) are still computed client-side and recorded
 *      additively, because the catalogue lives in the frontend. Cosmetic-only surface; it moves
 *      when the shared package does.
 */

export type Outcome = 'win' | 'loss' | 'push';

/**
 * A new account's opening position, in cents. The server grants this itself on profile creation
 * — it does NOT trust the `bankrollCents` in the create body, which is the whole difference
 * between Phase A (mirror the client) and Phase B (be the referee). Must equal the frontend's
 * `STARTING_BANKROLL_CENTS`; the parity test asserts it.
 */
export const STARTING_BANKROLL_CENTS = 500_000;

/**
 * XP per result, flat by outcome. Mirrors the frontend's `XP_BY_OUTCOME` — one knob, not scaled
 * by wager, so the non-betting games (chess, solitaire) are not second-class. Parity-tested.
 */
export const XP_BY_OUTCOME: Readonly<Record<Outcome, number>> = {
  win: 100,
  push: 20,
  loss: 10,
};

/** The daily ladder in cents, day 1 → day 7+. Mirrors `DAILY_REWARDS_CENTS`. Parity-tested. */
export const DAILY_REWARDS_CENTS: readonly number[] = [
  50_000, 75_000, 100_000, 150_000, 200_000, 250_000, 500_000,
];

export const DAY_MS = 86_400_000;

/**
 * The store, as the server sees it: id → price in cents, `null` meaning EARN-ONLY (unbuyable at
 * any balance — it is granted by an achievement, never sold). A `0` is a free starter.
 *
 * This is the half of `catalog.ts` that money depends on. The names, emoji and rarities are
 * presentation and stay in the frontend; a price is a fact the referee must own, because a client
 * that names its own price owns the store. Parity-tested against `CATALOG` id-for-id, so an item
 * added or repriced on one side and not the other fails the build rather than mispricing quietly.
 */
export const PRICES_CENTS: Readonly<Record<string, number | null>> = {
  // avatars — free starters
  av_person: 0,
  av_smile: 0,
  av_dice: 0,
  // avatars — buyable
  av_cowboy: 100_000,
  av_tophat: 250_000,
  av_clover: 500_000,
  av_crown: 1_000_000,
  av_shark: 1_500_000,
  av_diamond: 2_500_000,
  av_fire: 4_000_000,
  av_rocket: 7_500_000,
  av_dragon: 10_000_000,
  // card backs — all fifteen staged backs. P4 filled the ladder out (a pack needs depth or every
  // pull is a duplicate by the third open); the seven it added landed on the client only, and
  // `tests/economy-parity.test.ts` caught the drift the moment the two branches met. Without them
  // the server would refuse a purchase the store happily offers.
  cb_blue1: 0,
  cb_red1: 40_000,
  cb_green1: 40_000,
  cb_blue2: 40_000,
  cb_red2: 40_000,
  cb_green2: 40_000,
  cb_blue3: 250_000,
  cb_red3: 250_000,
  cb_blue4: 250_000,
  cb_green3: 250_000,
  cb_green4: 900_000,
  cb_blue5: 900_000,
  cb_red4: 900_000,
  cb_red5: 6_000_000,
  cb_green5: 6_000_000,
  // titles — two buyable, two earn-only
  ttl_regular: 150_000,
  ttl_highroller: 1_000_000,
  ttl_thehouse: null,
  ttl_grandmaster: null,
};

/**
 * The most a game can EVER return on a wager, as a multiple of the stake, gross.
 *
 * Blackjack's best case is a 3:2 natural — stake back plus 1.5× = 2.5× gross — and a double-down
 * commits a second wager of its own through `/bet`, so it is two stakes and two ceilings rather
 * than one bigger one. The default is deliberately loose (3×) because a ceiling that is too tight
 * silently refuses legitimate wins, which is a worse failure than one that is too loose: a loose
 * ceiling still kills "pay me a million on a $1 bet", which is the attack.
 *
 * A game absent here uses `DEFAULT_PAYOUT_MULTIPLE`. A game with no betting never reaches this —
 * a zero-wager settle must have a zero payout, checked separately.
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
 * The client checks the same thing before staging a chip (`validateBet`), and that check is for
 * feel — instant feedback, no round-trip. This one is the one that decides. They agree on the
 * rule; only this one is authoritative, which is the entire point of Phase B.
 *
 * `min`/`max` come from the game's manifest, which lives in the frontend — so they arrive on the
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
 * The zero-wager case is the non-betting games (chess, solitaire): they report an outcome to earn
 * XP and a stat, and their payout must be exactly 0. Letting a zero-stake settle pay anything is
 * a mint, and it is the shape a "just report a win" call would take.
 */
export interface SettleRequest {
  readonly gameId: string;
  readonly payoutCents: number;
  readonly openWagerCents: number | null;
}

export function checkSettle(req: SettleRequest): Decision<{ readonly payoutCents: number }> {
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
 */
export interface PurchaseRequest {
  readonly itemId: string;
  readonly balanceCents: number;
  readonly owned: boolean;
}

export function checkPurchase(req: PurchaseRequest): Decision<{ readonly priceCents: number }> {
  const price = PRICES_CENTS[req.itemId];
  if (price === undefined) return refuse('no such item');
  if (price === null) return refuse('that item cannot be bought — it is earned');
  if (req.owned) return refuse('already owned');
  if (price > req.balanceCents) return refuse('insufficient funds');
  return accept({ priceCents: price });
}

/** UTC day index. Equal indices are the same day — the whole trick, mirrored from `daily.ts`. */
export function dayIndex(nowMs: number): number {
  return Math.floor(nowMs / DAY_MS);
}

function rewardForStreak(streak: number): number {
  const idx = Math.min(Math.max(streak, 1), DAILY_REWARDS_CENTS.length) - 1;
  return DAILY_REWARDS_CENTS[idx] ?? DAILY_REWARDS_CENTS[DAILY_REWARDS_CENTS.length - 1] ?? 0;
}

export interface DailyState {
  readonly lastClaimDay: number;
  readonly streak: number;
}

/**
 * Claim today's reward against SERVER time, or refuse.
 *
 * `nowMs` is injected so this is testable to the millisecond, but the ROUTE passes the server's
 * clock and never the client's — which is the point of moving this here. The client's copy of
 * this rule already refuses a wound-back clock (`today > lastClaimDay`, not `!==`); that defends
 * an honest player against their own device. This one defends the economy against a dishonest
 * one, and it is the same comparison for the same reason.
 */
export function checkDaily(
  state: DailyState,
  nowMs: number
): Decision<{ readonly state: DailyState; readonly rewardCents: number }> {
  const today = dayIndex(nowMs);
  if (today <= state.lastClaimDay) return refuse('already claimed today');
  const consecutive = state.lastClaimDay > 0 && today === state.lastClaimDay + 1;
  const nextStreak = consecutive ? state.streak + 1 : 1;
  return accept({
    state: { lastClaimDay: today, streak: nextStreak },
    rewardCents: rewardForStreak(nextStreak),
  });
}
