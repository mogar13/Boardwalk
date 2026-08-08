/**
 * THE SEAMS FOR THE GAMES THE REFEREE DEALS — blackjack (a hand, and a table), Liar's Dice and UNO.
 *
 * Split out of `types.ts` when that file crossed the 800-line ceiling, and the cut is a real
 * relationship rather than a convenient one: every interface below describes a game where THE CLIENT
 * IS A RENDERER. None of them has a field for a card, a hand, an outcome or a payout, all of them
 * answer with the authoritative profile, and each is `null` on the Firebase fallback (except the
 * room-less blackjack hand, which has an offline twin because one player's hand can be dealt by a
 * reducer). Everything left in `types.ts` is the ordinary seam, where the client still computes.
 *
 * `types.ts` re-exports all of it, so nothing that imports `@/system/repo/types` moved.
 */
import type { Profile } from '@boardwalk/game-logic';
import type { RepoResult } from '@/system/repo/types';
import type { HandView } from '@boardwalk/game-logic/games/blackjack';
export type { HandView };
import type { Action as LiarsDiceAction } from '@boardwalk/game-logic/games/liars-dice';
export type { LiarsDiceAction };
import type { Move as UnoMove, UnoLevel } from '@boardwalk/game-logic/games/uno';
export type { UnoMove, UnoLevel };
import type { TableMove as BlackjackTableMove } from '@boardwalk/game-logic/games/blackjack';
export type { BlackjackTableMove };

/**
 * THE DEALT HAND — Phase D's seam, and the one place a game's rules live behind the repo.
 *
 * Every other game in this repo runs its rulebook in the browser and tells the economy what
 * happened. That is fine for the four that cannot win money, and it was never fine for Blackjack:
 * through Phase B the referee knew a stake had been placed and that the payout claimed against it
 * was under 2.5×, and nothing more, because there were no cards on the server. A client that
 * answered "blackjack" to every hand was inside every rule the referee had. A ceiling bounds that
 * theft; it cannot stop it, because "did this player actually win" is not a question you can ask
 * about a number.
 *
 * So the deal moves behind this interface. `deal` and `move` are the ONLY two verbs, and read what
 * they carry: a stake, a hand id, and one of three decisions. There is no field on either for a
 * card, an outcome or a payout — not validated away, ABSENT, which is the meta-rule (make the wrong
 * thing unspellable) applied to the last money surface the client still owned.
 *
 * The interface names one game, which is a thing this codebase otherwise refuses to do. It is
 * earned rather than assumed: the referee exposes `/blackjack/deal` and `/blackjack/move`, so the
 * game's name is already on the wire, and a `GameSessionRepo<TState>` invented for a second caller
 * that does not exist would be `validateAndCommit()` — the shared abstraction designed before
 * anyone needed it, with zero adopters. When a second game is dealt server-side, THAT is when the
 * shape of the general one is knowable.
 */

/** The three decisions a player may make on a live hand. Not results — a player may choose badly. */
export type BlackjackMove = 'hit' | 'stand' | 'double' | 'insure' | 'decline';

/**
 * WHAT A BLACKJACK PLAYER MAY SEE — the shared projection, re-exported so the repo interface
 * names it without redeclaring it.
 *
 * This interface was written out here and again in `boardwalk-api/src/domain/blackjack.ts`, with a
 * test comparing the two. Both are gone: the rule lives in
 * `@boardwalk/game-logic/games/blackjack` and both sides import it. Three copies of "what may a
 * client see" is three chances to reveal a card, and the two that are not the referee's are the
 * ones nobody would think to audit.
 *
 * The guarantee it carries is structural, not procedural: `HandView` has no `deck` field and no
 * hole card, so there is nothing to forget to strip. Same discipline as UNO's `toPublic`, pointed
 * at a server boundary instead of a room node.
 */

export interface BlackjackDealInput {
  readonly nonce: string;
  readonly wagerCents: number;
}

export interface BlackjackMoveInput {
  readonly nonce: string;
  readonly handId: number;
  readonly move: BlackjackMove;
}

/**
 * Both halves of an answer, always. A response carrying the hand without the balance would let a
 * client learn a card without learning what the card cost it, which is exactly the reconciliation
 * gap `EconomyRepo.apply` closes by returning the whole authoritative profile.
 */
export interface BlackjackTurn {
  readonly profile: Profile;
  readonly hand: HandView;
}

export interface BlackjackRepo {
  /** Stake, shuffle, deal. A dealt NATURAL comes back already `settled` and already paid. */
  deal(uid: string, input: BlackjackDealInput): Promise<RepoResult<BlackjackTurn>>;
  /** Hit, stand or double against a live hand. A double commits its second stake behind the seam. */
  move(uid: string, input: BlackjackMoveInput): Promise<RepoResult<BlackjackTurn>>;
}

/**
 * THE DEALT-MATCH SEAM (Phase E) — Liar's Dice, the second game the referee deals and the first
 * multiplayer one.
 *
 * It is its own interface and NOT a pair of methods on `RoomRepo`, for a concrete reason: every
 * `RoomRepo` method obligates the Firebase implementation too, and there is no Firebase version of
 * "the server holds the dice". A dealt game exists only on the WS path by construction — which is
 * also why `modes` for this game cannot include a fallback.
 *
 * `types.ts` says a generic `GameSessionRepo<TState>` was deliberately not invented when blackjack
 * was the only caller: "when a second game is dealt server-side, THAT is when the shape of the
 * general one is knowable." This IS the second caller, and the two turn out to rhyme in the half
 * that matters: both answer with the AUTHORITATIVE PROFILE. They differ only in the game state —
 * blackjack returns the hand, because a solo table has no other channel, while a Liar's Dice table
 * gets its state over the room subscription every seat is already holding.
 *
 * ANSWERING `void` WAS THE FIRST DRAFT AND IT WAS WRONG. The reasoning ("state arrives on the
 * subscription anyway") is true of the state and false of the profile: `start` takes every human's
 * ante and a settling action pays the pot, and neither of those travels over a room subscription.
 * Two accounts anted a dollar each in a real browser, the ledger recorded both, and both top bars
 * went on saying $5,000. So the profile comes back, exactly as blackjack's does.
 *
 * NEITHER INPUT HAS A FIELD FOR A DIE, AN OUTCOME OR A PAYOUT. Absent, not validated.
 */
export interface LiarsDiceStartInput {
  readonly nonce: string;
  readonly anteCents: number;
}

export interface LiarsDiceActionInput {
  readonly nonce: string;
  readonly action: LiarsDiceAction;
}

export interface LiarsDiceRepo {
  /** Roll, deal and take every human's ante. Host only. Answers this caller's profile. */
  start(gameId: string, roomId: string, input: LiarsDiceStartInput): Promise<RepoResult<Profile>>;
  /**
   * Bid, challenge or call spot-on. The resulting GAME STATE reaches this client through the room
   * subscription and its own private node, exactly as it reaches everyone else at the table — so
   * there is one code path for "the match moved". What comes back here is the PROFILE, because a
   * settling action pays the pot and no subscription carries that.
   */
  act(gameId: string, roomId: string, input: LiarsDiceActionInput): Promise<RepoResult<Profile>>;
}

/**
 * UNO'S SEAM TO THE REFEREE — the same shape as Liar's Dice's, with the stake taken out.
 *
 * `UnoStartInput` has no `anteCents` and that is the whole difference. The table's stake is stamped
 * on the ROOM at create (`RoomMeta.anteCents`), agreed to by everybody who then sat down, and read
 * from there by the referee — so a client cannot name what it is about to be charged. A hostile
 * host that could would play a perfectly FAIR game at a price nobody consented to, which validation
 * cannot fix because there is no wrong number to reject: the number is simply not the client's to
 * say. (`LiarsDiceStartInput` above still carries one; closing that is a follow-up.)
 *
 * `level` IS a client's choice, and the distinction is the point: a difficulty cannot move a chip,
 * cannot name an outcome, and the worst a hostile value does is make the house play badly against
 * whoever sent it.
 *
 * NEITHER INPUT HAS A FIELD FOR A CARD, A HAND, A WINNER OR A PAYOUT. Absent, not validated.
 */
export interface UnoStartInput {
  readonly nonce: string;
  /** How hard the bots play. Not money — see above. */
  readonly level: UnoLevel;
}

export interface UnoMoveInput {
  readonly nonce: string;
  readonly move: UnoMove;
}

export interface UnoRepo {
  /**
   * Deal a round: shuffle, take every human's ante, hand out the cards. HOST ONLY, and idempotent
   * through the nonce so a double-fire is a replay rather than a second round and a second ante.
   */
  start(gameId: string, roomId: string, input: UnoStartInput): Promise<RepoResult<Profile>>;
  /**
   * Play a card or draw one. The resulting GAME STATE reaches this client through the room
   * subscription and its own private node, exactly as it reaches everyone else — so there is one
   * code path for "the table moved", and the host's own moves take it too. What comes back HERE is
   * the PROFILE, because a settling move pays the pot and no subscription carries a balance.
   */
  move(gameId: string, roomId: string, input: UnoMoveInput): Promise<RepoResult<Profile>>;
}

/**
 * THE BLACKJACK TABLE'S SEAM — the fourth dealt game, and the only one whose SOLO half already had a
 * seam of its own (`BlackjackRepo`, above). Both are here and both are blackjack: one deals a hand
 * to a player with no room, the other deals a round to a table of chairs, and they run the same
 * rulebook out of `@boardwalk/game-logic/games/blackjack`.
 *
 * `open` HAS NO STAKE, and that is the difference from every other dealt `start` in this file.
 * `LiarsDiceStartInput` carries one and `UnoStartInput` deliberately does not (the table's ante is
 * the room's). Here there is no table stake to carry: a chair's stake is its own, per round, and it
 * arrives on `act` as `{type:'bet', wagerCents}` — the single number a client sends in this game.
 *
 * That number is a DECISION about how much of your own money to risk, which the referee bounds
 * against the LEDGER before it deals a card. Neither input has a field for a card, a hand, an
 * outcome or a payout — absent, not validated.
 */
export interface BlackjackTableStartInput {
  readonly nonce: string;
}

export interface BlackjackTableActionInput {
  readonly nonce: string;
  readonly move: BlackjackTableMove;
}

export interface BlackjackTableRepo {
  /** Open a round: seat everybody and wait for stakes. HOST ONLY, idempotent through the nonce. */
  open(
    gameId: string,
    roomId: string,
    input: BlackjackTableStartInput
  ): Promise<RepoResult<Profile>>;
  /**
   * Bet, hit, stand, double, insure or decline. The resulting TABLE reaches this client on the room
   * subscription exactly as it reaches everyone else — there is one code path for "the table moved".
   * What comes back HERE is the PROFILE, because every one of those six can move money and no room
   * subscription carries a balance.
   */
  act(
    gameId: string,
    roomId: string,
    input: BlackjackTableActionInput
  ): Promise<RepoResult<Profile>>;
}
