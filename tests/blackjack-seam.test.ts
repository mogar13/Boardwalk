import { beforeEach, describe, expect, test } from 'vitest';
import { defaultProfile } from '@/system/profile/defaults';
import { localBlackjackRepo } from '@/system/repo/local/blackjackRepo';
import type { EconomyRepo, HandView, Profile, ProfileRepo, RepoResult } from '@/system/repo/types';
import {
  freshDeck,
  initialState,
  isBlackjack,
  payoutCents,
  reducer,
  shuffle,
  type BlackjackState,
} from '@boardwalk/game-logic/games/blackjack';
// The projection the REFEREE also runs — literally the same function, out of the shared package.
// This import is the assertion the old cross-boundary parity test used to make.
import { viewOf } from '@boardwalk/game-logic/games/blackjack';

/**
 * THE DEALT-HAND SEAM (BACKEND_PLAN.md Phase D), frontend half.
 *
 * Two things are worth testing here and they are not the rulebook. The rulebook is already pinned
 * to the line in `tests/blackjack.test.ts` and is now a single shared module both sides import, so
 * re-asserting that a dealer stands on 17 would be testing `@boardwalk/game-logic` a second time.
 * What is NEW and untested is the seam itself:
 *
 *   1. THE LOCAL IMPLEMENTATION PLAYS THE SAME GAME. It is what a fresh clone, the emulator loop
 *      and a Pi outage get, and it is a second place a hand can be played — so it has to agree with
 *      the shared reducer card for card and cent for cent, or the offline table quietly becomes a
 *      different game than the deployed one.
 *   2. THE PROJECTION HIDES THE SAME THING THE REFEREE'S DOES. `HandView` is the whole privacy
 *      claim of the phase ("a player with devtools open sees what a player without them sees"), and
 *      it is implemented twice — once in TypeScript on the Pi, once here. A copy with a guard is a
 *      copy; a copy without one is a drift waiting for a player to find it.
 */

/** A seeded generator, so every hand below is an exact hand rather than a lucky one. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UID = 'player-1';
const START = 500_000; // the opening stake, in cents

/**
 * A stand-in for the composed repos, and it is deliberately the CLIENT-AUTHORITATIVE pair — which
 * is exactly what the local blackjack repo runs over in the wild (`firebaseEconomyRepo` persists
 * whatever the pure logic computed). Money therefore moves here the same way it moves with no API
 * configured, and `bankroll()` below reads the number the player would actually be left holding.
 */
function fakeRepos(profile: Profile) {
  let stored: Profile = profile;
  /** Every intent the seam raised, in order — the ledger this test can inspect. */
  const intents: { kind: string; amountCents?: number; payoutCents?: number }[] = [];

  const profileRepo: ProfileRepo = {
    load: (_uid: string) => Promise.resolve(stored),
    create: () => Promise.resolve(),
    save: (_uid: string, next: Profile) => {
      stored = next;
      return Promise.resolve();
    },
  };

  const economy: EconomyRepo = {
    apply: (_uid, intent, clientNext): Promise<RepoResult<Profile>> => {
      intents.push({
        kind: intent.kind,
        ...(intent.kind === 'bet' ? { amountCents: intent.amountCents } : {}),
        ...(intent.kind === 'settle' ? { payoutCents: intent.payoutCents } : {}),
      });
      stored = clientNext;
      return Promise.resolve({ ok: true, value: clientNext });
    },
  };

  return { profileRepo, economy, intents, bankroll: () => stored.bankrollCents };
}

function setup(seed: number) {
  const fakes = fakeRepos({ ...defaultProfile('Tester'), bankrollCents: START });
  const repo = localBlackjackRepo({
    economy: fakes.economy,
    profile: fakes.profileRepo,
    rng: mulberry32(seed),
  });
  return { repo, ...fakes };
}

/** Unwrap a turn, failing loudly on a refusal — a refused call in a happy-path test is the bug. */
function ok<T>(result: RepoResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got refusal: ${result.error}`);
  return result.value;
}

/** The reference play-through: the shared reducer, the same seed, the same deck. */
function reference(seed: number, wagerCents: number): BlackjackState {
  return reducer(initialState(), {
    type: 'deal',
    deck: shuffle(freshDeck(), mulberry32(seed)),
    wagerCents,
  });
}

/**
 * Find a seed that deals the hand this test needs.
 *
 *   `natural`  — the opening two cards are 21, so the deal settles itself.
 *   `playable`  — the player is left to act.
 *   `stands`   — the player is left to act AND survives one hit, so a stand actually happens. The
 *                first playable seed busts on its hit, and a test that quietly took the bust branch
 *                every run would be asserting nothing about standing at all.
 */
function findSeed(want: 'natural' | 'playable' | 'stands'): number {
  for (let seed = 1; seed < 5000; seed++) {
    const dealt = reference(seed, 1000);
    if (want === 'natural') {
      if (dealt.phase === 'settled' && isBlackjack(dealt.player)) return seed;
      continue;
    }
    if (dealt.phase !== 'player') continue;
    if (want === 'playable') return seed;
    if (reducer(dealt, { type: 'hit' }).phase === 'player') return seed;
  }
  throw new Error(`no seed produced a ${want} deal`);
}

let NATURAL_SEED = 0;
let PLAYABLE_SEED = 0;
let STANDS_SEED = 0;
beforeEach(() => {
  NATURAL_SEED = findSeed('natural');
  PLAYABLE_SEED = findSeed('playable');
  STANDS_SEED = findSeed('stands');
});

describe('the local dealer plays the shared rulebook', () => {
  test('a deal matches the reducer card for card, and takes the stake once', async () => {
    const { repo, intents, bankroll } = setup(PLAYABLE_SEED);
    const expected = reference(PLAYABLE_SEED, 2500);

    const turn = ok(await repo.deal(UID, { nonce: 'n1', wagerCents: 2500 }));

    expect(turn.hand.player).toEqual(expected.player);
    expect(turn.hand.phase).toBe('player');
    expect(turn.hand.wagerCents).toBe(2500);
    // One `bet` intent and nothing else — the hand is live, so nothing has settled yet.
    expect(intents).toEqual([{ kind: 'bet', amountCents: 2500 }]);
    expect(bankroll()).toBe(START - 2500);
  });

  test('hit then stand walks the same states the reducer does, and pays what it says', async () => {
    const { repo, intents, bankroll } = setup(STANDS_SEED);
    const dealt = ok(await repo.deal(UID, { nonce: 'n1', wagerCents: 2500 }));

    // The oracle: the same reducer, driven with the same actions.
    let expected = reference(STANDS_SEED, 2500);
    expected = reducer(expected, { type: 'hit' });

    const hit = ok(await repo.move(UID, { nonce: 'n2', handId: dealt.hand.handId, move: 'hit' }));
    expect(hit.hand.player).toEqual(expected.player);
    // The seed guarantees the hit survived, so the stand below is really a stand — see `findSeed`.
    expect(expected.phase).toBe('player');

    expected = reducer(expected, { type: 'stand' });
    const stood = ok(
      await repo.move(UID, { nonce: 'n3', handId: dealt.hand.handId, move: 'stand' })
    );
    expect(stood.hand.dealer).toEqual(expected.dealer);
    expect(stood.hand.result).toBe(expected.result);

    // Settled exactly once, for exactly the payout the shared rulebook computes on the stake that
    // was taken. This is the assertion that would have caught a client crediting itself.
    const settles = intents.filter((i) => i.kind === 'settle');
    expect(settles).toHaveLength(1);
    expect(settles[0]?.payoutCents).toBe(payoutCents(expected.result ?? 'lose', 2500));
    expect(bankroll()).toBe(START - 2500 + (settles[0]?.payoutCents ?? 0));
  });

  test('a double stakes a second wager, doubles the recorded bet, and settles over both', async () => {
    const { repo, intents, bankroll } = setup(PLAYABLE_SEED);
    const dealt = ok(await repo.deal(UID, { nonce: 'n1', wagerCents: 2500 }));
    expect(dealt.hand.canDouble).toBe(true);

    const doubled = ok(
      await repo.move(UID, { nonce: 'n2', handId: dealt.hand.handId, move: 'double' })
    );
    const expected = reducer(reference(PLAYABLE_SEED, 2500), { type: 'double' });

    expect(doubled.hand.doubled).toBe(true);
    expect(doubled.hand.wagerCents).toBe(5000); // the reducer's already-doubled figure
    expect(doubled.hand.result).toBe(expected.result);
    // TWO bet intents of the ORIGINAL size, and one settle priced on the doubled stake. The client
    // never sends a payout on either path; this proves the local one computes the same total the
    // referee would.
    expect(intents.filter((i) => i.kind === 'bet')).toEqual([
      { kind: 'bet', amountCents: 2500 },
      { kind: 'bet', amountCents: 2500 },
    ]);
    const settle = intents.find((i) => i.kind === 'settle');
    expect(settle?.payoutCents).toBe(payoutCents(expected.result ?? 'lose', 5000));
    expect(bankroll()).toBe(START - 5000 + (settle?.payoutCents ?? 0));
  });

  test('a dealt natural settles inside the deal — there is no move to make', async () => {
    const { repo, intents } = setup(NATURAL_SEED);
    const turn = ok(await repo.deal(UID, { nonce: 'n1', wagerCents: 1001 }));

    expect(turn.hand.phase).toBe('settled');
    expect(turn.hand.result).toBe('blackjack');
    // The 3:2 on an ODD wager — `floor(1001 * 3 / 2)` plus the stake back. This is v1's dropped
    // chip, and it is the number that has to survive every layer between the deck and the bankroll.
    expect(intents.find((i) => i.kind === 'settle')?.payoutCents).toBe(1001 + 1501);

    // And a move against it is refused rather than quietly doing nothing.
    const after = await repo.move(UID, { nonce: 'n2', handId: turn.hand.handId, move: 'hit' });
    expect(after.ok).toBe(false);
  });
});

describe('the local dealer refuses what the referee refuses', () => {
  test('a stake past the bankroll takes nothing and deals nothing', async () => {
    const { repo, intents, bankroll } = setup(PLAYABLE_SEED);

    const refused = await repo.deal(UID, { nonce: 'n1', wagerCents: START + 1 });

    expect(refused.ok).toBe(false);
    // Nothing was staged. A refusal that had already written the `bet` intent would be the exact
    // "a `return` out of a transaction COMMITS" hazard the referee's ordering is written around.
    expect(intents).toEqual([]);
    expect(bankroll()).toBe(START);
  });

  test('a repeated nonce replays the first answer instead of dealing a second hand', async () => {
    const { repo, intents, bankroll } = setup(PLAYABLE_SEED);

    const first = ok(await repo.deal(UID, { nonce: 'same', wagerCents: 2500 }));
    const again = ok(await repo.deal(UID, { nonce: 'same', wagerCents: 2500 }));

    expect(again.hand.handId).toBe(first.hand.handId);
    expect(again.hand.player).toEqual(first.hand.player);
    // ONE stake. A browser retries; an economy that is not replay-safe is one flaky connection
    // from a duplicate deduction.
    expect(intents.filter((i) => i.kind === 'bet')).toHaveLength(1);
    expect(bankroll()).toBe(START - 2500);
  });

  test('a hand that does not exist is a refusal, not a crash', async () => {
    const { repo } = setup(PLAYABLE_SEED);
    const result = await repo.move(UID, { nonce: 'n1', handId: 999, move: 'hit' });
    expect(result).toEqual({ ok: false, error: 'no such hand' });
  });
});

describe('the projection hides the hole card, exactly as the referee does', () => {
  /**
   * IDENTITY, NOT PARITY — and that is the whole point of this phase.
   *
   * This block used to import `viewOf` from `boardwalk-api/src/domain/blackjack` and run it beside
   * a local twin, asserting the two agreed field-for-field, because the projection existed twice:
   * once in the referee and once here. That construction is the `economy-parity` test wearing a
   * different hat, and it earns the same answer now that the shared package exists — the rule
   * moved to `@boardwalk/game-logic/games/blackjack` and both sides import it, so there is nothing
   * left to compare.
   *
   * What is still worth testing is the OUTPUT, because this is the one function on either side
   * whose bug is invisible: a hole card that leaks renders perfectly, plays perfectly, and simply
   * tells the player what the dealer has. So the assertions below go through the REPO — the only
   * door the projection has — and check what a client can actually be handed.
   */
  const localView = async (seed: number, wagerCents: number) => {
    const { repo } = setup(seed);
    const turn = ok(await repo.deal(UID, { nonce: 'n1', wagerCents }));
    return turn.hand;
  };

  test('a live hand carries ONE dealer card, and it is the up-card', async () => {
    const view = await localView(PLAYABLE_SEED, 2500);
    const truth = reference(PLAYABLE_SEED, 2500);

    expect(view.phase).toBe('player');
    expect(view.dealer).toHaveLength(1);
    expect(view.dealer[0]).toEqual(truth.dealer[0]);
    // The hole card is not in the payload under any other name either. Serialising the whole view
    // and looking for it is the version of this assertion that survives someone adding a field.
    const wire = JSON.stringify(view);
    expect(wire).not.toContain(JSON.stringify(truth.dealer[1]));
    expect(wire).not.toContain(JSON.stringify(truth.deck[0]));
    expect(wire).not.toContain('deck');
  });

  test('a settled hand reveals the whole dealer hand', async () => {
    const view = await localView(NATURAL_SEED, 1000);
    const truth = reference(NATURAL_SEED, 1000);

    expect(view.phase).toBe('settled');
    expect(view.dealer).toEqual(truth.dealer);
  });

  test('what the repo hands out is exactly what the shared projection produces', async () => {
    for (const seed of [PLAYABLE_SEED, NATURAL_SEED]) {
      // Through the REPO, which is the only door the projection has — so this checks the thing a
      // client is actually handed, not a re-statement of the rule. The referee's answer is the
      // same call on the same state, which is why it no longer needs importing to compare.
      const mine: HandView = await localView(seed, 2500);
      expect(mine).toEqual(viewOf(mine.handId, reference(seed, 2500)));
    }
  });
});
