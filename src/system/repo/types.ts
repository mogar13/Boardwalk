import type { IdentityMode } from '@/system/auth/credentials';
import type { ChatMessage } from '@/system/chat/types';
import type { Profile } from '@boardwalk/game-logic';
// The dealt hand's vocabulary comes from the SAME rulebook the board renders and the referee
// deals from — `@boardwalk/game-logic/games/blackjack`. Importing the types rather than restating
// them is what stops the seam from becoming a second, drifting description of a card: if the
// rulebook's `Result` gains a case, every implementation of `BlackjackRepo` stops compiling until
// it handles one, which is the whole reason the logic packages were extracted in the first place.
import type {
  Card as BlackjackCard,
  Phase as BlackjackPhase,
  Result as BlackjackResult,
} from '@boardwalk/game-logic/games/blackjack';
import type { Session } from '@/system/auth/session';
// Type-only, and type-only is why the cycle is fine: boards.ts imports the `LeaderboardEntry`
// type from here, this imports the `BoardId` type from there, and both erase at compile — there
// is no runtime import cycle, only a compile-time one the type checker resolves.
import type { BoardId } from '@/system/progress/boards';
import type { RoomSnapshot, Seat, SeatOccupant } from '@/system/room/types';

/**
 * The seam. Everything above this line talks to these interfaces; exactly one
 * directory below it knows what Firebase is.
 *
 * WHY THE SEAM IS WORTH ITS WEIGHT. ARCHITECTURE.md keeps Firebase RTDB and rejects
 * VS-Dashboard's Express+SQLite, because realtime sync is the one thing this app
 * genuinely needs and the one thing SQLite will not give you without hand-building
 * websocket transport. That bet is good today and might not be forever — the moment
 * the economy has to stop being client-authoritative (BACKEND_PLAN.md), the work is
 * rewriting `./firebase/*` and changing which object `./index.ts` exports. Not
 * touching a game. `@boardwalk/no-firebase-imports` is what keeps that sentence true.
 *
 * PHASE 5 ADDED `RoomRepo` AND `ChatRepo`, and it did so the only way that has ever worked
 * here: designed by the hooks that needed them. Phase 2 pointedly LEFT them out — "writing the
 * other two now would take ten minutes and be exactly the mistake this codebase was founded to
 * avoid" (v1's `validateAndCommit()`: written to end hand-rolled bet math, ZERO adopters). The
 * difference in Phase 5 is that `useRoom`/`useSeats`/`useChat` and the lobby are being built in
 * the same phase, so every method below has a caller in this same commit. The shapes are what
 * those callers asked for — a subscription that hands back its own teardown (so a game cannot
 * leak a listener), a seq-bumping state write (so no game re-derives UNO's ordering fix), and a
 * per-seat private channel (so hidden information is a data-layout guarantee, not a UI trick).
 */

/**
 * Stop listening. Returned by every subscribe-shaped method here, and returning it is
 * not a style choice.
 *
 * v1's `SystemUI.on()` has no `off()` at all, so listeners accumulate for the page's
 * lifetime; 22 of its 25 multiplayer games leak a live Firebase subscription per lobby
 * close. Handing back the teardown at the moment of subscription is what makes the
 * caller's cleanup a one-liner instead of a thing they must remember to write
 * somewhere else — and in React it is literally what `useEffect` wants returned, so
 * the correct code is also the shortest code. This is the shape `useRoom<T>()` will be
 * built on in Phase 5.
 */
export type Unsubscribe = () => void;

/**
 * Every repo call that can fail because of something the USER did returns one of
 * these. Calls that can only fail because something is broken throw.
 *
 * The distinction is the useful one: "username already taken" is data the form must
 * render; "the database is unreachable" is not a form state. Making both an exception
 * means the form catches everything and renders `err.message` — which is how a raw
 * Firebase error code ends up in front of a player. Making both a Result means real
 * bugs get swallowed by an `if (!ok)` branch. So: expected failures are values,
 * unexpected ones are exceptions.
 */
export type RepoResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export interface SignUpInput {
  readonly username: string;
  readonly password: string;
  /**
   * Optional, and the fork the whole identity design turns on.
   *
   * Absent: the account's Auth identity is a synthetic `@boardwalk.invalid` address
   * derived from the username. Sign in with the username. NO PASSWORD RECOVERY IS
   * POSSIBLE, EVER — there is nowhere to send it, and the UI has to say so before they
   * choose, not after they forget.
   *
   * Present: the Auth identity IS the real address, which therefore must never enter
   * the world-readable `usernames/` index. That node stores `viaEmail: true` instead —
   * see credentials.ts.
   */
  readonly email?: string;
}

export interface SignInInput {
  /** A username or an email. The repo decides which by shape and resolves it. */
  readonly identifier: string;
  readonly password: string;
}

export interface AuthRepo {
  /**
   * The authoritative session stream. Fires immediately with the current answer
   * (`null` if signed out), then on every change.
   *
   * THE SUBSCRIPTION IS THE API, and a `getSession()` is deliberately absent. Firebase
   * restores a session asynchronously on page load, so any synchronous getter returns
   * `null` during first paint and something else a tick later — which is a race every
   * caller loses individually. v1 fought this with an optimistic localStorage cache
   * (`_activeUid` restored synchronously "so hub code calling isLoggedIn() during first
   * render sees the right answer") plus a reconcile pass that tears it back down. That
   * works, and it is a lot of machinery to answer a question the callback already
   * answers. Here the store subscribes once and the app renders a loading state until
   * the first fire — which is the honest thing to render, because until then the answer
   * genuinely is not known.
   */
  onSessionChanged(listener: (session: Session | null) => void): Unsubscribe;

  /**
   * Create the Auth user and claim the username index. Does NOT write the profile —
   * see ProfileRepo.create and the ordering note in `@/system/auth/authStore`.
   */
  signUp(input: SignUpInput): Promise<RepoResult<Session>>;

  signIn(input: SignInInput): Promise<RepoResult<Session>>;

  signOut(): Promise<void>;

  /**
   * ALWAYS SUCCEEDS FOR A WELL-FORMED ADDRESS, including one with no account.
   *
   * That is not sloppiness, it is the point: reporting "no such user" turns this form
   * into an account-enumeration oracle. v1 gets this right and says so in a comment —
   * "Don't confirm or deny whether the address exists" — and both branches return the
   * identical string. It is a one-word change to "improve" this into a vulnerability.
   *
   * It DOES fail for a synthetic address: those cannot receive mail, and an account
   * with no email has no recovery path. Saying so plainly beats a reset that silently
   * goes nowhere.
   */
  sendPasswordReset(email: string): Promise<RepoResult<void>>;
}

export interface ProfileRepo {
  /** `null` means the record genuinely is not there — an authoritative server answer, not a guess. */
  load(uid: string): Promise<Profile | null>;

  /**
   * Write a fresh record: the private profile AND its public leaderboard projection,
   * which exist separately because `users/` is not world-readable and a leaderboard is.
   */
  create(uid: string, profile: Profile): Promise<void>;

  /**
   * Persist a MUTATED record — Phase 4's writer. The economy computes the whole next profile
   * with pure logic (`applyResult`, `applyPurchase`, `claimDaily`) and hands it here; this is
   * the only path money moves after sign-up. Same both-nodes-or-neither guarantee as `create`.
   *
   * It takes the whole profile, not a patch, because the domain object is small and always
   * held complete in the store — and because a patch API is a setter with extra steps, and the
   * design turns on there being no setter a game can reach. The economy hooks are the only
   * callers; a game gets `useBet`/`reportResult`, never this.
   */
  save(uid: string, profile: Profile): Promise<void>;
}

/**
 * AN INTENT: what the player is trying to do, NOT what it should cost.
 *
 * This is the whole shape of BACKEND_PLAN.md's Phase B. Before it, money moved by the client
 * computing a next profile and saving it — so the wire carried a balance, and whoever controls the
 * wire controls the balance. After it, the wire carries a verb and its arguments, and the server
 * decides the number. Notice what these types make UNSPELLABLE: there is no field on any of them
 * for a bankroll, a price, a payout ceiling, an XP amount, a stat count, or a clock. A client
 * cannot ask for money because the request has no place to put the ask.
 *
 * `nonce` is on every one of them and is not optional. A browser retries — on a flaky connection,
 * on a double tap, and (per the locked Phase-B decision) when an offline result syncs on
 * reconnect. The nonce is what makes the second arrival a no-op that returns the first arrival's
 * answer instead of moving money again. It is minted client-side per intent and is meaningless
 * beyond being unique for this uid.
 */
interface IntentBase {
  readonly nonce: string;
}

export type EconomyIntent =
  /** Stake a wager. The server checks it against the LEDGER balance, not the one we hold. */
  | (IntentBase & { readonly kind: 'bet'; readonly gameId: string; readonly amountCents: number })
  /**
   * Settle a hand of a game the SERVER DOES NOT DEAL — the four that do not bet (chess, uno,
   * solitaire, tic-tac-toe). Their honest payout is 0, and `checkSettle`'s zero-wager branch
   * enforces exactly that, so the only thing this can move is XP and a stat.
   *
   * Blackjack does NOT come through here any more. The server deals that hand and settles it
   * from its own cards (`BlackjackRepo`, below), which is what makes the payout stop being a
   * claim for the one game where a claim was worth money.
   *
   * `feats` is the only achievement input left on the wire, because no state predicate can see a
   * two-card 21 or a Solitaire cleared without a recycle. The server filters it to ids marked
   * `feat: true` and recomputes every other badge from its own tables — so a chain tier and the
   * earn-only cosmetic it grants can no longer be asked for. Phase D removed
   * `unlockedAchievementIds`/`grantedItemIds` rather than validating them.
   */
  | (IntentBase & {
      readonly kind: 'settle';
      readonly gameId: string;
      readonly outcome: 'win' | 'loss' | 'push';
      readonly payoutCents: number;
      readonly feats?: readonly string[];
    })
  /** Buy a cosmetic. Names the ITEM; the price is the server's to look up. */
  | (IntentBase & { readonly kind: 'purchase'; readonly itemId: string })
  /** Claim the daily reward. Carries no timestamp — the server's clock is the only one. */
  | (IntentBase & { readonly kind: 'daily' })
  /**
   * Open a pack. Names the PACK and nothing else — and the omissions are the design, the same way
   * they are on `purchase` and `daily`.
   *
   * THERE IS NO SEED AND NO ITEM HERE, and that is the whole reason this intent exists. A pack's
   * outcome is the one thing in the economy the request cannot determine: `purchase` names what
   * it is buying, but a pack names a gamble, and whoever rolls it decides what falls out. If the
   * client rolled, the client would pick its own legendary and the odds table the store card
   * publishes would be decoration.
   *
   * (Before this intent, `openPack()` ran client-side and saved the whole computed profile
   * through `PUT /profile` — which accepts name, avatar and equipped, and silently dropped the
   * deduction AND the grant. The animation played; nothing happened.)
   */
  | (IntentBase & { readonly kind: 'pack'; readonly packId: string });

/**
 * What the server rolled, as it comes off the wire: an ID, not a cosmetic. The caller resolves it
 * through the shared `CATALOG`/`isPackable`, which is what keeps `PackPull.item` typed as a
 * `PackableCosmetic` — an earn-only cosmetic cannot be spelled as a pull on this side either,
 * whatever the wire claims.
 */
export interface PackPullWire {
  readonly itemId: string;
  readonly duplicate: boolean;
  readonly dustCents: number;
}

/**
 * What a money mutation answers with: always the authoritative profile, plus — for a pack open
 * and nothing else — what the roll produced.
 *
 * `pull` is `null` on every other intent AND in the Firebase fallback, where there is no referee
 * to roll and the client's own `openPack` result is the truth. The caller falls back to its
 * optimistic pull in exactly that case, which is the same "two trust models, one seam" asymmetry
 * `clientNext` already encodes.
 */
export interface EconomyOutcome {
  readonly profile: Profile;
  readonly pull: PackPullWire | null;
}

/**
 * The money writer, behind the seam. Phase B's addition, and the reason `ProfileRepo.save` no
 * longer moves a chip.
 *
 * `apply` returns the AUTHORITATIVE profile — the store replaces its optimistic copy with it, so a
 * disagreement resolves in the server's favour within one round trip rather than lingering until
 * some later read. A refusal ("insufficient funds", "already claimed today") is a `RepoResult`
 * failure and not a throw, because it is ordinary game state the UI renders; a broken connection
 * still throws.
 *
 * `clientNext` is the profile the pure client logic already computed. THE SERVER-BACKED
 * IMPLEMENTATION IGNORES IT — that is the point — and it exists only for the Firebase fallback,
 * which has no referee and must persist the client's arithmetic the way v2 always did. That
 * asymmetry is deliberate and is the honest shape of "one seam, two trust models": with
 * `VITE_API_BASE_URL` unset (a fresh clone, the emulator, a Pi outage) the app is exactly the
 * client-authoritative economy it was through Phase 6, and with it set the client cannot cheat.
 */
export interface EconomyRepo {
  apply(
    uid: string,
    intent: EconomyIntent,
    clientNext: Profile
  ): Promise<RepoResult<EconomyOutcome>>;
}

/**
 * A batch of server-signed nonces, plus where the account stands.
 *
 * `enabled: false` means this server does not enforce tickets (no `TICKET_SECRET`), and the client
 * keeps minting its own nonces exactly as it did before offline banking existed. It is a THIRD
 * state alongside "granted" and "refused", and it is worth the field: a client that could not tell
 * "not required" from "the route is broken" would either retry forever or silently stop banking.
 */
export interface TicketBatch {
  readonly enabled: boolean;
  readonly tickets: readonly string[];
  /** Unspent tickets the server believes this ACCOUNT holds, across every device it has claimed. */
  readonly outstanding: number;
}

/**
 * THE OFFLINE BANKING BUDGET, behind the seam.
 *
 * A ticket is a nonce the client cannot mint. It is spent in the `nonce` field of a `settle` — so
 * `EconomyIntent` does not change by one field, and the property that no intent has a place to put
 * a balance, a price, an XP amount, a stat count, a clock, a seed or an item survives untouched.
 *
 * The interface is one method because there is exactly one thing to ask: a client requests tickets
 * and the server decides how many, capped per-ACCOUNT. There is no "return a ticket" and no "how
 * many do I have" — the first would be a way to un-spend, and the second is answered by the grant.
 *
 * `deviceId` is a client-chosen sequence namespace and NOT a credential: nothing attests it, a
 * client may claim to be a hundred devices, and the server's cap is per-uid precisely so that
 * inventing devices divides the budget instead of multiplying it. See
 * `plans/OFFLINE_HARDENING.md` and `boardwalk-api/src/domain/tickets.ts`.
 */
export interface TicketRepo {
  issue(deviceId: string, want: number): Promise<TicketBatch>;
}

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
export type BlackjackMove = 'hit' | 'stand' | 'double';

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
import type { HandView } from '@boardwalk/game-logic/games/blackjack';
export type { HandView };

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
 * One row of the public standings, read from `leaderboard/<uid>`. This is the public
 * projection — the five fields the rules pin, plus the uid the node is keyed by — and nothing
 * private: the leaderboard cannot show what `users/` holds, because it never reads it.
 */
export interface LeaderboardEntry {
  readonly uid: string;
  readonly name: string;
  readonly avatar: string;
  readonly bankrollCents: number;
  readonly xp: number;
  /** Total wins across every game — the wins-board rank key. Derived by the writer, never stored. */
  readonly wins: number;
  /**
   * Total games played across everything — the denominator the Win Rate board ranks on. Projected
   * alongside `wins` (both derived sums of the private `stats`), because a rate needs both halves
   * public. `winRate` itself is NOT projected: it is derived from these two, the same "one source
   * of truth" call as `level` from `xp` — storing the ratio would be a third number to drift.
   */
  readonly played: number;
}

/**
 * The leaderboard reader. Designed HERE, in Phase 4, because Phase 4 is where the page that
 * reads it finally exists — the same discipline that kept `RoomRepo` out of Phase 2. A reader
 * with no reader is `validateAndCommit()`.
 *
 * `top(limit, board)` returns rows already ranked FOR THAT BOARD — the sort still lives behind the
 * repo, not in the page, so two screens cannot rank the same board differently. What changed since
 * Phase 4 is only that there are four boards to ask for (`BoardId`); `board` defaults to `'wins'`,
 * so the original single-board callers are unchanged. The one source of truth for every board's
 * order is `@/system/progress/boards`, which both this repo and the page import. Reads are public
 * (the node is world-readable), so this needs no auth.
 */
export interface LeaderboardRepo {
  top(limit: number, board?: BoardId): Promise<readonly LeaderboardEntry[]>;
}

/**
 * The realtime room, behind the seam. This is the interface `useRoom<T>()` is built on, and its
 * shape is the whole answer to v1's largest duplication: the same 20-line `listenToRoom()` in 27
 * games, 22 of them leaking the listener (ARCHITECTURE.md). Two properties every method here is
 * designed to guarantee:
 *
 *   • EVERY SUBSCRIBE HANDS BACK ITS OWN TEARDOWN (`Unsubscribe`), so the caller's cleanup is a
 *     one-liner it cannot forget — the same reason `AuthRepo.onSessionChanged` does.
 *   • THE OS OWNS ORDERING. `patchState` is a seq-bumping transaction, so a game never re-derives
 *     UNO's `stateSeq` fix and never orders by wall-clock.
 *
 * Generic over `TPublic` — the game's shared state, whose shape is the game's business. The repo
 * moves it around opaquely; only the game and its `logic/` ever look inside it.
 */
export interface RoomRepo {
  /**
   * Create a room and return its short join code. The repo mints the code (a room id a human can
   * read aloud), seats the host, and stamps `createdAt`/`seq`. `RepoResult` because a code
   * collision — two rooms minted the same instant — is contention the lobby renders ("try
   * again"), not a crash; a broken database still throws.
   */
  create(
    gameId: string,
    init: { seatCount: number; host: SeatOccupant }
  ): Promise<RepoResult<string>>;

  /**
   * Subscribe to the PUBLIC room — meta, seats, state, presence — firing immediately with the
   * current value and on every change, `null` once the room is gone. Returns the teardown. This
   * is the subscription 27 v1 games hand-rolled and the OS now owns exactly once.
   */
  subscribe<TPublic>(
    gameId: string,
    roomId: string,
    listener: (snapshot: RoomSnapshot<TPublic> | null) => void
  ): Unsubscribe;

  /**
   * Take a seat. Claim-then-verify (ARCHITECTURE.md — "write, re-read, confirm, else SEAT
   * TAKEN"): the repo writes optimistically then re-reads, and `ok: false` means another client
   * won the race. No transaction, on purpose — the re-read is cheaper and the seat rules already
   * refuse an illegal claim.
   */
  claimSeat(
    gameId: string,
    roomId: string,
    index: number,
    who: SeatOccupant
  ): Promise<RepoResult<void>>;

  /** Leave a seat, turning it into an AI (game in progress) or an open chair (lobby). */
  releaseSeat(
    gameId: string,
    roomId: string,
    index: number,
    fallback: 'ai' | 'open'
  ): Promise<void>;

  /**
   * Drop a bot into an open seat, or clear one back to open. The lobby's "fill with AI" — an AI is
   * an occupant KIND, not a mode, so seating one is a seat write like any other, and the host uses
   * it to complete a table (vs-AI) or leave chairs open (online). `name` is the bot's label.
   */
  setAi(gameId: string, roomId: string, index: number, name: string | null): Promise<void>;

  /**
   * Advance the shared state. `produce` receives the current state (or `null` before start) and
   * returns the next; the repo applies it inside a transaction that bumps `seq`, so concurrent
   * patches serialize and the ordering key can never skip or repeat. The producer must be pure —
   * a transaction can retry it — which is exactly the discipline `logic/` already enforces.
   */
  patchState<TPublic>(
    gameId: string,
    roomId: string,
    produce: (prev: TPublic | null) => TPublic
  ): Promise<void>;

  /** Move the room through its lifecycle. Host-gated by the rules. */
  setStatus(
    gameId: string,
    roomId: string,
    status: RoomSnapshot<unknown>['meta']['status']
  ): Promise<void>;

  /**
   * HIDDEN INFORMATION. Write a seat's private state (`rooms/.../private/<idx>`), and subscribe to
   * it — but a client only ever subscribes to ITS OWN seat's node, and `database.rules.json`
   * refuses a read of anyone else's. This is what makes "a bystander never receives opponents'
   * cards" a data-layout-and-rule guarantee rather than a UI trick (v1's UNO did the layout half;
   * Phase 5 adds the rule half). Writing another seat's private node is allowed only for the host
   * — the dealer deals.
   */
  writePrivate<TPrivate>(
    gameId: string,
    roomId: string,
    index: number,
    data: TPrivate
  ): Promise<void>;
  subscribePrivate<TPrivate>(
    gameId: string,
    roomId: string,
    index: number,
    listener: (data: TPrivate | null) => void
  ): Unsubscribe;

  /**
   * Mark this uid present and arm `onDisconnect` cleanup, so a closed tab or dropped connection
   * clears presence server-side without the client having to run any code. Returns the teardown
   * that clears it on a clean unmount. v1 leaked presence because nothing armed the disconnect
   * handler; here it is the only way presence is ever written.
   */
  trackPresence(gameId: string, roomId: string, uid: string): Unsubscribe;

  /**
   * Remove the whole room node. Host-only (rule-enforced), and called by the hook only when the
   * pure planner (`@/system/room/lifecycle`) says the last participant is leaving — a granular
   * step the hook maps a `{ target: 'room' }` teardown step to, alongside `releaseSeat` for a
   * seat step and the presence unsubscribe for a presence step. Uses the `remove` → `set(null)`
   * fallback v1 needed for the case where a plain remove is refused mid-teardown.
   */
  remove(gameId: string, roomId: string): Promise<void>;
}

/**
 * Room chat, behind the seam. Separate from `RoomRepo` because chat and game state have different
 * shapes, different lifetimes, and different rules (a message's author is pinned to `auth.uid`;
 * game state is not), and v1's single god-object conflating them is part of what this project
 * escapes.
 */
export interface ChatRepo {
  /**
   * Send a message. The repo stamps the ordering key (`messageKey`) and the author's `uid`, which
   * the rules pin to `auth.uid` — so a forged author is refused at the server. `RepoResult`
   * because a rejected send (rate-limited, offline) is something the composer shows, not a throw.
   */
  send(
    gameId: string,
    roomId: string,
    message: { uid: string; name: string; text: string }
  ): Promise<RepoResult<void>>;

  /**
   * Subscribe to the last `limit` messages, already in send order (the key sorts them), firing on
   * every new message. Returns the teardown.
   */
  subscribe(
    gameId: string,
    roomId: string,
    listener: (messages: readonly ChatMessage[]) => void,
    limit: number
  ): Unsubscribe;

  /** Wipe the room's chat. HOST ONLY — the same "only the host clears remote chat" rule as v1. */
  clear(gameId: string, roomId: string): Promise<void>;
}

/**
 * The set of repos the app runs on. `@/system/repo` exports one of these and it is the
 * only wiring that names an implementation.
 *
 * Phase 4 adds the economy's writers here; Phase 5 adds rooms and chat. Each arrives
 * with the code that calls it.
 */
export interface Repos {
  readonly auth: AuthRepo;
  readonly profile: ProfileRepo;
  /** Phase B: the only path a chip moves. See `EconomyRepo`. */
  readonly economy: EconomyRepo;
  /** Phase D: the one game whose cards are not the client's. See `BlackjackRepo`. */
  readonly blackjack: BlackjackRepo;
  /** Offline hardening: the nonces a client cannot mint. See `TicketRepo`. */
  readonly tickets: TicketRepo;
  readonly leaderboard: LeaderboardRepo;
  readonly room: RoomRepo;
  readonly chat: ChatRepo;
}

/** Re-exported so a consumer never needs a second import to type an error branch. */
export type {
  BlackjackCard,
  BlackjackPhase,
  BlackjackResult,
  ChatMessage,
  IdentityMode,
  Profile,
  RoomSnapshot,
  Seat,
  SeatOccupant,
  Session,
};
