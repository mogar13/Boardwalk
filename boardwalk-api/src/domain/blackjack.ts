/**
 * BLACKJACK, DEALT AND SETTLED BY THE REFEREE. Phase D's headline, and the end of `payoutCents` as
 * a thing a client says.
 *
 * WHAT THIS CLOSES. Through Phase B the server knew two things about a hand: that a stake had been
 * placed, and that the payout claimed against it was not larger than 2.5× (`checkSettle`, the
 * ceiling). It did not know what cards were on the table, because there were no cards on the
 * server — the deck was shuffled in the browser and the browser reported the result. So a client
 * that quietly answered "blackjack" to every hand was inside every rule the referee had, and would
 * have taken 2.5× on every deal forever. The ceiling bounded the theft per hand; it could not stop
 * it, and no ceiling can, because "did this player actually win" is not a question you can ask
 * about a number.
 *
 * So the server deals. `shuffle(freshDeck(), rng)` runs HERE, the reducer runs HERE, and the payout
 * is `payoutCents(result, wagerCents)` over the server's own cards. Neither request body has a
 * field for a payout, an outcome or a card — the wrong thing is unspellable rather than validated,
 * which is the meta-rule this whole codebase is an instance of.
 *
 * IT IS THE SAME RULEBOOK, NOT A SECOND ONE. Every function above comes from
 * `@boardwalk/game-logic/games/blackjack` — the module the board renders from, unit-tested to the
 * last line before a card was ever drawn on screen. That is the entire reason the logic packages
 * were extracted: a server that re-implemented ace-soft scoring would be v1's `texas_holdem`
 * recording itself as `"poker"` wearing a bigger hat, and the drift would surface as the house
 * quietly playing a different game than the table shows.
 *
 * WHAT THE CLIENT IS TOLD is `HandView`, and it is a projection in the same sense UNO's `toPublic`
 * is: the deck and the hole card are not "hidden with CSS", they are never sent. A player with
 * devtools open sees exactly what a player without them sees. That is the "Done when" of this
 * phase, and `tests/blackjack.test.ts` asserts it directly rather than trusting it.
 *
 * WHAT IS STILL THE CLIENT'S. The bet amount (checked), which hand to act on, and which of hit /
 * stand / double. Those are decisions, not results — a player is allowed to make bad ones.
 */
import {
  canDouble,
  freshDeck,
  initialState,
  isBlackjack,
  payoutCents,
  reducer,
  resultOutcome,
  shuffle,
  viewOf,
  type BlackjackState,
  type HandView,
} from '@boardwalk/game-logic/games/blackjack';
import type { Db } from '../db/db';
import { checkBet, type Decision } from './economy';
import { appendLedger, claimNonce, recordOutcome } from './mutations';
import { balanceOf, loadProfile } from './profile';
import type { Profile } from './types';

/** From `manifest.id`, never a string literal — the same rule the frontend registry keys on. */
const GAME_ID = 'blackjack';

/* ------------------------------------------------------------------ view */

/**
 * WHAT A PLAYER MAY SEE — `viewOf`/`HandView`, imported from the shared package.
 *
 * This projection used to be defined here, and an identical one lived in the frontend's offline
 * table, with a test comparing the two field-for-field. That test was the tell: a guard that
 * compares two implementations of one rule is the same construction as the `economy-parity` test
 * this phase deleted, and it earns the same answer. So the rule moved to
 * `@boardwalk/game-logic/games/blackjack` and both sides import it — see that file for why the
 * hole card is sliced off rather than faked, and why `HandView` has no `deck` field to forget to
 * strip.
 */

/* --------------------------------------------------------------- results */

/** The shared projection, re-exported so a route or a test reads it off the module it uses. */
export { viewOf, type HandView };

export interface BlackjackOk {
  readonly profile: Profile;
  readonly hand: HandView;
  /** True when the nonce had already been applied and this call changed nothing. */
  readonly replayed: boolean;
}

export type BlackjackResult = Decision<BlackjackOk>;

const refuse = (error: string): BlackjackResult => ({ ok: false, error });

/**
 * Answer with the authoritative profile and the hand as it now stands. Both, always — a response
 * that carried the hand without the balance would let a client learn a card without learning what
 * the card cost it, which is the reconciliation gap the money routes deliberately close.
 */
function answer(
  db: Db,
  uid: string,
  handId: number,
  state: BlackjackState,
  replayed: boolean
): BlackjackResult {
  const profile = loadProfile(db, uid);
  if (profile === null) return refuse('no profile');
  return { ok: true, value: { profile, hand: viewOf(handId, state), replayed } };
}

/* ---------------------------------------------------------- persistence */

interface HandRow {
  id: number;
  state_json: string;
  settled: number;
}

/**
 * Load a hand BY UID AS WELL AS BY ID. The uid is not decoration on this query.
 *
 * A hand id is a small sequential integer, so it is guessable by typing. Scoping the read to the
 * authenticated uid makes another account's hand a refusal instead of a peek at their cards —
 * and, more sharply, stops one account acting on another's hand and settling money into it. This
 * is the `usernames/`-is-world-readable lesson in a different table: an id is not a secret, so the
 * query must carry the authority.
 */
function loadHand(db: Db, uid: string, handId: number): HandRow | undefined {
  return db
    .prepare('SELECT id, state_json, settled FROM blackjack_hands WHERE id = ? AND uid = ?')
    .get(handId, uid) as HandRow | undefined;
}

/** The stored blob back as state. Written by this module and nothing else, so it is trusted. */
const stateOf = (row: HandRow): BlackjackState => JSON.parse(row.state_json) as BlackjackState;

function persist(db: Db, handId: number, state: BlackjackState, settled: boolean, now: number): void {
  db.prepare('UPDATE blackjack_hands SET state_json = ?, settled = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(state), settled ? 1 : 0, now, handId);
}

/**
 * Remember which hand a nonce acted on, so a replay can answer with THAT hand. See the column's
 * note in `schema.ts` — without it a stale retry would be handed whatever hand is newest.
 */
function pinNonce(db: Db, uid: string, nonce: string, handId: number): void {
  db.prepare('UPDATE mutations SET hand_id = ? WHERE uid = ? AND nonce = ?').run(handId, uid, nonce);
}

/** The hand a previously-applied nonce acted on, for the replay answer. */
function replayFor(db: Db, uid: string, nonce: string): BlackjackResult {
  const row = db.prepare('SELECT hand_id AS h FROM mutations WHERE uid = ? AND nonce = ?').get(
    uid,
    nonce
  ) as { h: number | null } | undefined;
  const handId = row?.h ?? null;
  if (handId === null) return refuse('that nonce was used by a different kind of mutation');
  const hand = loadHand(db, uid, handId);
  if (hand === undefined) return refuse('no such hand');
  return answer(db, uid, hand.id, stateOf(hand), true);
}

/* ------------------------------------------------------------ settlement */

/**
 * Close a finished hand: credit the payout, close its stakes, record the outcome.
 *
 * THE PAYOUT IS COMPUTED HERE, from `state.result` and `state.wagerCents`, both of which the
 * reducer wrote from the server's own cards. There is no argument to this function a request could
 * reach. `state.wagerCents` is already the doubled figure after a double-down, and both wager rows
 * were opened against this hand, so one `payoutCents` over the doubled stake is the correct total
 * and both rows close together.
 *
 * Runs inside the caller's transaction — money, stats and XP move together or not at all.
 */
function settleHand(db: Db, uid: string, handId: number, state: BlackjackState, now: number): void {
  const result = state.result;
  // Only ever called on a settled hand; a null result here would be a reducer bug, and paying 0
  // silently would hide it, so it is treated as the impossibility it is.
  if (result === null) throw new Error('settleHand: the hand has no result');

  const payout = payoutCents(result, state.wagerCents);
  if (payout > 0) appendLedger(db, uid, GAME_ID, payout, 'settle', now);

  // Both stakes for THIS hand, by name. Not "the oldest open wager for blackjack" — that rule is
  // right for a game the server cannot see and wrong for one it can, because an abandoned hand's
  // stake would be consumed by an unrelated settlement later.
  db.prepare('UPDATE wagers SET settled_at = ? WHERE uid = ? AND hand_id = ? AND settled_at IS NULL')
    .run(now, uid, handId);

  persist(db, handId, state, true, now);

  // `feat_natural` is DETECTED, not reported — the first feat the server can see for itself.
  //
  // Feats are on the wire at all because no state predicate can see them: a Solitaire cleared
  // without recycling the stock is a fact only the game knows. A two-card 21 used to be in that
  // category for exactly the same reason, and it no longer is, because the server dealt the two
  // cards. So it comes off the wire and is read off `result === 'blackjack'`, which is the shape
  // every feat should eventually take: the server-dealt game is the one that can stop asking.
  const feats = result === 'blackjack' ? ['feat_natural'] : [];

  recordOutcome(db, uid, GAME_ID, resultOutcome(result), state.wagerCents, payout, feats, now);
}

/**
 * Is this stake legal and affordable? Read INSIDE the caller's transaction, so a double the player
 * cannot cover is judged against the balance the deal's own deduction has already left them with,
 * and two requests racing one balance cannot both pass.
 */
function checkStake(db: Db, uid: string, wagerCents: number): Decision<number> {
  const checked = checkBet({ amountCents: wagerCents, balanceCents: balanceOf(db, uid) });
  if (!checked.ok) return { ok: false, error: checked.error };
  return { ok: true, value: checked.value.amountCents };
}

/**
 * Commit a checked stake: the negative ledger row and the open `wagers` row, together.
 *
 * Separate from the check, and always called AFTER every refusal a request can trigger, because a
 * `return` out of a better-sqlite3 transaction COMMITS — only a throw rolls back. So "refuse and
 * change nothing" is not something the transaction gives us for free; it is something the order of
 * these statements has to earn. Nothing is written until nothing can refuse.
 */
function commitStake(db: Db, uid: string, handId: number, amountCents: number, now: number): void {
  appendLedger(db, uid, GAME_ID, -amountCents, 'bet', now);
  db.prepare(
    'INSERT INTO wagers (uid, game_id, wager_cents, created_at, settled_at, hand_id) VALUES (?, ?, ?, ?, NULL, ?)'
  ).run(uid, GAME_ID, amountCents, now, handId);
}

/**
 * Give a nonce back on a refusal.
 *
 * A refused request did nothing, so it must not have consumed anything either — including the
 * client's nonce. Without this, a player who tries to double $5,000 they cannot afford has burned
 * that nonce: their next attempt with it would take the replay branch and find no hand pinned to
 * it, turning an honest "insufficient funds" into a baffling one-off error the client cannot
 * retry out of. Same reasoning as the `return`-commits note above — the rollback has to be written
 * down, because the transaction will not do it for a value return.
 */
function releaseNonce(db: Db, uid: string, nonce: string): void {
  db.prepare('DELETE FROM mutations WHERE uid = ? AND nonce = ?').run(uid, nonce);
}

/* ------------------------------------------------------------------ deal */

export interface DealInput {
  readonly nonce: string;
  readonly wagerCents: number;
}

/**
 * Deal a hand. One transaction: the nonce claim, the stake, the shuffle, the deal, and — if the
 * player was dealt a natural — the whole settlement, because that hand is over before the client
 * has seen it and splitting it across two requests would leave a settled hand waiting on a call
 * the browser might never make.
 *
 * `rng` is injected and defaults to `Math.random`. It is a test seam, and it is the same seam the
 * pure `shuffle` already offered: a test can drive an exact hand — a natural on an odd wager, a
 * dealer bust — without stubbing a global. It is NOT a knob any request can reach.
 */
export function dealHand(
  db: Db,
  uid: string,
  input: DealInput,
  now: number,
  rng: () => number = Math.random
): BlackjackResult {
  const tx = db.transaction((): BlackjackResult => {
    if (!claimNonce(db, uid, input.nonce, 'bj-deal', now)) return replayFor(db, uid, input.nonce);

    // The affordability check comes before ANY write, so an unaffordable deal leaves no orphan
    // hand row behind it — see `commitStake` for why the ordering is load-bearing.
    const staked = checkStake(db, uid, input.wagerCents);
    if (!staked.ok) {
      releaseNonce(db, uid, input.nonce);
      return refuse(staked.error);
    }

    // Nothing can refuse from here on. The hand row is written first so the stake can name it.
    const insert = db
      .prepare(
        'INSERT INTO blackjack_hands (uid, state_json, settled, created_at, updated_at) VALUES (?, ?, 0, ?, ?)'
      )
      .run(uid, JSON.stringify(initialState()), now, now);
    const handId = Number(insert.lastInsertRowid);

    commitStake(db, uid, handId, staked.value, now);

    // THE SHUFFLE IS HERE. This line is the phase: the deck exists on the server, is dealt from on
    // the server, and its remainder is written to `state_json` where no response can reach it.
    const dealt = reducer(initialState(), {
      type: 'deal',
      deck: shuffle(freshDeck(), rng),
      wagerCents: staked.value,
    });

    pinNonce(db, uid, input.nonce, handId);

    // A dealt natural is already settled by the reducer — the player stands on 21 and the dealer
    // reveals. Same transaction, so the 3:2 lands with the deal rather than waiting for a move
    // the client has no reason to send. (`isBlackjack` is asserted rather than assumed: the only
    // way `deal` settles is a natural on one side or both.)
    if (dealt.phase === 'settled') {
      if (!isBlackjack(dealt.player) && !isBlackjack(dealt.dealer)) {
        throw new Error('dealHand: a deal settled without a natural');
      }
      settleHand(db, uid, handId, dealt, now);
    } else {
      persist(db, handId, dealt, false, now);
    }

    return answer(db, uid, handId, dealt, false);
  });
  return tx();
}

/* ------------------------------------------------------------------ move */

export type Move = 'hit' | 'stand' | 'double';

export interface MoveInput {
  readonly nonce: string;
  readonly handId: number;
  readonly move: Move;
}

/**
 * Play one move against a live hand. One transaction, idempotent on the nonce, and — like the deal
 * — it settles inline the moment the hand is over, because a bust and a stand both finish the hand
 * within the same call that caused them.
 *
 * Note the input: a hand and a decision. There is no card, no outcome and no payout, so the most a
 * dishonest client can do here is play badly.
 */
export function playMove(db: Db, uid: string, input: MoveInput, now: number): BlackjackResult {
  const tx = db.transaction((): BlackjackResult => {
    if (!claimNonce(db, uid, input.nonce, 'bj-move', now)) return replayFor(db, uid, input.nonce);

    // Every refusal below gives the nonce back first, so a retry of a refused move behaves like a
    // first attempt rather than falling into the replay branch with no hand pinned to it.
    const deny = (error: string): BlackjackResult => {
      releaseNonce(db, uid, input.nonce);
      return refuse(error);
    };

    const row = loadHand(db, uid, input.handId);
    // The same refusal for "no such hand" and "somebody else's hand", on purpose: distinguishing
    // them would turn this route into an oracle for which hand ids exist.
    if (row === undefined) return deny('no such hand');
    if (row.settled === 1) return deny('that hand is already settled');

    const before = stateOf(row);
    if (before.phase !== 'player') return deny('that hand is not awaiting a move');

    // A double commits a SECOND stake of the same size. Both its checks run before anything is
    // written, so an unaffordable double leaves the hand exactly as it found it — still playable,
    // with one open stake and no orphan ledger row.
    let doubleStake: number | null = null;
    if (input.move === 'double') {
      // Legality first, affordability second. `canDouble` is the rulebook's own predicate (opening
      // two cards, still the player's turn) rather than a re-derivation of it here.
      if (!canDouble(before)) return deny('a double is not legal on this hand');
      const staked = checkStake(db, uid, before.wagerCents);
      if (!staked.ok) return deny(staked.error);
      doubleStake = staked.value;
    }

    const state = reducer(before, { type: input.move });

    // The reducer is total: an illegal action returns the state unchanged rather than throwing.
    // That is right for a double-clicked button and wrong to persist silently here, because a
    // move that changed nothing after a stake was taken would be a lost chip.
    if (state === before) return deny('that move does nothing on this hand');

    // Nothing can refuse from here on.
    if (doubleStake !== null) commitStake(db, uid, row.id, doubleStake, now);

    pinNonce(db, uid, input.nonce, row.id);
    // `settleHand` writes the row itself (with `settled = 1`), so persisting first would be a
    // write that only exists to be overwritten inside the same transaction.
    if (state.phase === 'settled') settleHand(db, uid, row.id, state, now);
    else persist(db, row.id, state, false, now);

    return answer(db, uid, row.id, state, false);
  });
  return tx();
}
