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
  STARTING_BANKROLL_CENTS,
  XP_BY_OUTCOME,
  claimDaily,
  cosmeticById,
  type DailyState,
  type Outcome,
} from '@boardwalk/game-logic';

export { DAILY_REWARDS_CENTS, DAY_MS, STARTING_BANKROLL_CENTS, XP_BY_OUTCOME };
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
 */
export const SERVER_DEALT_GAMES: ReadonlySet<string> = new Set(['blackjack']);

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
