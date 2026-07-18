import { applyResult, validateBet, type Profile } from '@boardwalk/game-logic';
import {
  canDouble,
  freshDeck,
  initialState,
  payoutCents,
  reducer,
  resultOutcome,
  shuffle,
  // The SHARED projection — the same four lines the referee runs, not a local twin of them.
  // See its file for why the hole card is sliced off rather than faked.
  viewOf,
  type BlackjackState as HandState,
} from '@boardwalk/game-logic/games/blackjack';
import type {
  BlackjackDealInput,
  BlackjackMoveInput,
  BlackjackRepo,
  BlackjackTurn,
  EconomyRepo,
  ProfileRepo,
  RepoResult,
} from '@/system/repo/types';

/**
 * THE LOCAL TABLE — the same seam with no referee behind it, and the reason a fresh clone still
 * deals a hand.
 *
 * It is the sibling of `firebaseEconomyRepo`, and it exists for the same three situations that one
 * does: a clone with no `VITE_API_BASE_URL`, the emulator dev loop (whose `demo-boardwalk` tokens
 * the Pi's verifier rejects), and a Pi outage where the kill switch has to be a rebuild rather than
 * a revert. BACKEND_PLAN.md's locked decision is that offline stays a real mode, not a broken one.
 *
 * IT DEALS THE HAND HONESTLY AND IT CANNOT ENFORCE ANYTHING. The cards are shuffled in the browser
 * by the player's own machine, so a determined player can rewrite them — and this file does not
 * pretend otherwise. That is exactly the situation Phase D exists to end, which is why the
 * composition root prefers the HTTP repo whenever it can reach one. What this DOES buy is that the
 * table above it has one code path: the board renders a `HandView` and dispatches a `move` whether
 * or not there is a server, so the honest mode and the enforced mode cannot drift into two
 * different games. When the Pi is up, none of the code below runs.
 *
 * MONEY STILL MOVES THE ONLY WAY IT EVER MOVES. This does not touch a bankroll: it stages a `bet`
 * intent and a `settle` intent through the injected `EconomyRepo`, which is the same path
 * `useBet().commit()` and `reportResult()` take. So with the API off it persists the client's own
 * arithmetic (today's behaviour, unchanged), and with `VITE_API_BLACKJACK=0` while the API is UP it
 * runs those intents against the LIVE referee — which is precisely the Phase-B economy the kill
 * switch is supposed to restore, ceiling and all, rather than an untested third thing.
 *
 * HANDS LIVE IN MEMORY, NOT `localStorage`. A reload abandons a live hand and its stake, which is
 * the same thing that happens if you close the tab at a real table — and persisting the deck would
 * write the one object this whole phase is about keeping out of the client's reach into a store the
 * player can open and read. The stake is already recorded through the economy repo, so nothing is
 * lost except the hand.
 */

/** From `manifest.id`, never a string literal spelled twice — the `texas_holdem`→`"poker"` rule. */
const GAME_ID = 'blackjack';


/**
 * The stake check, mirroring the referee's `checkBet`: a whole number of cents, positive, and
 * covered by the balance. Deliberately NOT the table's min/max — those are the chip rack's job
 * (`useBet` reads them from the manifest) and the referee does not trust them either, because
 * bounds that arrive from the client can only ever tighten a player's own table.
 */
function checkStake(amountCents: number, profile: Profile): RepoResult<number> {
  const checked = validateBet(amountCents, profile.bankrollCents, {
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
  });
  return checked.ok
    ? { ok: true, value: checked.amountCents }
    : { ok: false, error: checked.error };
}

export interface LocalBlackjackDeps {
  /** Where the stake and the payout go. The composed `EconomyRepo` — HTTP or Firebase, unknown here. */
  readonly economy: EconomyRepo;
  /** Where the current balance is read from, freshly, per call. See `currentProfile` below. */
  readonly profile: ProfileRepo;
  /** Injected so a test can deal an exact hand — the seam `shuffle` already offered. */
  readonly rng?: () => number;
}

export function localBlackjackRepo(deps: LocalBlackjackDeps): BlackjackRepo {
  const rng = deps.rng ?? Math.random;

  /** Live hands, by id. The referee's `blackjack_hands` table, minus the durability. */
  const hands = new Map<number, HandState>();
  /** Which hand a nonce already acted on, so a retry replays instead of dealing a second hand. */
  const applied = new Map<string, number>();
  let nextHandId = 1;

  /**
   * Read the profile FRESH rather than caching it.
   *
   * A cached copy would go stale the moment anything else moved money — a daily claim landing
   * between two hands — and the economy repo persists a whole profile, so settling a hand against
   * a stale base would silently erase that claim. That is the lost-update hazard `mutateProfile`
   * documents, and one read per call is a cheap price for not reintroducing it here.
   */
  const currentProfile = async (uid: string): Promise<Profile | null> => deps.profile.load(uid);

  /** Stage the wager. Returns the profile the economy answered with, or the refusal to pass on. */
  async function stake(
    uid: string,
    nonce: string,
    profile: Profile,
    amountCents: number
  ): Promise<RepoResult<Profile>> {
    return await deps.economy.apply(
      uid,
      { kind: 'bet', nonce, gameId: GAME_ID, amountCents },
      { ...profile, bankrollCents: profile.bankrollCents - amountCents }
    );
  }

  /**
   * Close a finished hand: credit the gross payout, record the outcome, XP and stats — one intent,
   * because `applyResult` returns them as one object and splitting them back apart is the v1
   * failure this codebase is named after.
   *
   * `feat_natural` is DETECTED here from `result === 'blackjack'` rather than reported by the
   * board, which is the same move the referee makes: a two-card 21 is a fact whoever dealt the
   * cards can see for itself, so the table stops being asked.
   */
  async function settle(
    uid: string,
    nonce: string,
    profile: Profile,
    state: HandState
  ): Promise<RepoResult<Profile>> {
    const result = state.result;
    // Only ever called on a settled hand; a null result is a reducer bug, and paying 0 quietly
    // would hide it.
    if (result === null) throw new Error('settle: the hand has no result');

    const report = {
      outcome: resultOutcome(result),
      payoutCents: payoutCents(result, state.wagerCents),
      wagerCents: state.wagerCents,
      ...(result === 'blackjack' ? { feats: ['feat_natural'] } : {}),
    };
    const predicted = applyResult(profile, GAME_ID, report, Date.now());

    return await deps.economy.apply(
      uid,
      {
        kind: 'settle',
        nonce,
        gameId: GAME_ID,
        outcome: report.outcome,
        payoutCents: report.payoutCents,
        ...(report.feats !== undefined ? { feats: report.feats } : {}),
      },
      predicted.profile
    );
  }

  /**
   * Answer a nonce that has already been applied with the hand it acted on. The referee does this
   * from its `mutations` table; here the map is that table. Without it a double-tapped Deal would
   * stake twice, which is the whole reason a nonce is on every one of these calls.
   */
  function replay(uid: string, nonce: string): Promise<RepoResult<BlackjackTurn>> | null {
    const handId = applied.get(nonce);
    if (handId === undefined) return null;
    const state = hands.get(handId);
    if (state === undefined) return null;
    return (async (): Promise<RepoResult<BlackjackTurn>> => {
      const profile = await currentProfile(uid);
      if (profile === null) return { ok: false, error: 'no profile' };
      return { ok: true, value: { profile, hand: viewOf(handId, state) } };
    })();
  }

  /**
   * The settle-or-persist tail both verbs share. A hand that finished inside this call is settled
   * NOW rather than on a later request the browser may never make — a dealt natural is over before
   * the player has seen it, and a bust is over the moment the card lands.
   *
   * A GAP, NAMED RATHER THAN PAPERED OVER. The referee does all of this inside one SQLite
   * transaction, so the cards and the money commit together or not at all. There is no transaction
   * here, so a settle the economy REFUSES (only reachable with the API up and this kill switch
   * thrown, where the 409 ceiling still applies) leaves a hand recorded as settled and unpaid, and
   * the refusal is what the player is shown. That is the honest limit of a client pretending to be
   * a referee, and it is an argument for the deployed default rather than a bug to engineer around
   * here: with no API at all the economy repo persists locally and cannot refuse.
   */
  async function finish(
    uid: string,
    nonce: string,
    profile: Profile,
    handId: number,
    state: HandState
  ): Promise<RepoResult<BlackjackTurn>> {
    hands.set(handId, state);
    applied.set(nonce, handId);

    if (state.phase !== 'settled') {
      return { ok: true, value: { profile, hand: viewOf(handId, state) } };
    }
    // A derived nonce, not a fresh one: the settlement of THIS hand by THIS request must collapse
    // to one effect if the whole call is retried, and a random second nonce would let a replay pay
    // the hand twice.
    const settled = await settle(uid, `${nonce}:settle`, profile, state);
    if (!settled.ok) return settled;
    return { ok: true, value: { profile: settled.value, hand: viewOf(handId, state) } };
  }

  return {
    async deal(uid: string, input: BlackjackDealInput): Promise<RepoResult<BlackjackTurn>> {
      const replayed = replay(uid, input.nonce);
      if (replayed !== null) return await replayed;

      const profile = await currentProfile(uid);
      if (profile === null) return { ok: false, error: 'no profile' };

      // Affordability BEFORE anything is recorded, so a refused deal leaves no hand behind it.
      const staked = checkStake(input.wagerCents, profile);
      if (!staked.ok) return staked;

      const paid = await stake(uid, input.nonce, profile, staked.value);
      if (!paid.ok) return paid;

      const handId = nextHandId++;
      // The shuffle. On this path it is the player's own machine, which is the honest limit of an
      // offline mode and the reason the deployed default is the other implementation.
      const dealt = reducer(initialState(), {
        type: 'deal',
        deck: shuffle(freshDeck(), rng),
        wagerCents: staked.value,
      });
      return await finish(uid, input.nonce, paid.value, handId, dealt);
    },

    async move(uid: string, input: BlackjackMoveInput): Promise<RepoResult<BlackjackTurn>> {
      const replayed = replay(uid, input.nonce);
      if (replayed !== null) return await replayed;

      const before = hands.get(input.handId);
      if (before === undefined) return { ok: false, error: 'no such hand' };
      if (before.phase === 'settled') return { ok: false, error: 'that hand is already settled' };
      if (before.phase !== 'player')
        return { ok: false, error: 'that hand is not awaiting a move' };

      let profile = await currentProfile(uid);
      if (profile === null) return { ok: false, error: 'no profile' };

      // A double commits a SECOND stake of the same size, and both its checks run before anything
      // is written — an unaffordable double leaves the hand exactly as it found it, still playable.
      if (input.move === 'double') {
        if (!canDouble(before)) return { ok: false, error: 'a double is not legal on this hand' };
        const staked = checkStake(before.wagerCents, profile);
        if (!staked.ok) return staked;
        const paid = await stake(uid, input.nonce, profile, staked.value);
        if (!paid.ok) return paid;
        profile = paid.value;
      }

      const state: HandState = reducer(before, { type: input.move });
      // The reducer is total: an illegal action returns the state unchanged rather than throwing.
      // Right for a double-clicked button, wrong to record — after a double's stake was taken, a
      // move that changed nothing would be a lost chip.
      if (state === before) return { ok: false, error: 'that move does nothing on this hand' };

      return await finish(uid, input.nonce, profile, input.handId, state);
    },
  };
}
