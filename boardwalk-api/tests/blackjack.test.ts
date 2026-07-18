import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  freshDeck,
  payoutCents,
  settle,
  shuffle,
  type Card,
} from '@boardwalk/game-logic/games/blackjack';
import { buildApp } from '../src/app';
import type { ApiConfig } from '../src/config';
import type { TokenVerifier } from '../src/auth/verify';
import { openDb, type Db } from '../src/db/db';
import type { Profile } from '../src/domain/types';
import { dealHand, playMove, viewOf, type HandView } from '../src/domain/blackjack';
import { STARTING_BANKROLL_CENTS } from '../src/domain/economy';
import { balanceOf, loadProfile, upsertProfile } from '../src/domain/profile';

/**
 * supertest types `res.body` as `any`, so every route assertion below was untyped — the checker
 * saw nothing, and a misspelled `hand.handID` would have compared `undefined` and failed for a
 * reason with nothing to do with the dealer. Narrow ONCE, here, and a typo is a compile error
 * again. Same shape as `bodyOf`/`profileOf` in api.test.ts; the API's own eslint config (which
 * did not exist when this file was written) is what surfaced it.
 */
interface TurnBody {
  readonly profile: Profile;
  readonly hand: HandView;
  readonly replayed: boolean;
}
const turnOf = (res: { body: unknown }): TurnBody => res.body as TurnBody;


/**
 * PHASE D'S CENTRAL CLAIM, under test: the client cannot name its own payout, and cannot see the
 * cards it has not been dealt.
 *
 * The Phase-B suite's shape holds — the refusals matter more than the happy paths — but two tests
 * here are of a kind that suite could not contain, because the server had no cards: the exact-hand
 * tests. An injected rng drives a KNOWN deal, so "a natural pays 2.5× and the half-cent does not
 * evaporate" is asserted against real cards on a real table rather than against a number a request
 * supplied. That is the v1 `parseInt` chip, checked one layer further down than it has ever been.
 */

/* ------------------------------------------------------------ the seam */

const same = (a: Card, b: Card): boolean => a.suit === b.suit && a.rank === b.rank;

/**
 * An rng that makes `shuffle` produce a CHOSEN order — a stacked deck, without stubbing a global
 * or teaching the shuffle a test-only mode.
 *
 * `shuffle` is Fisher–Yates from the top down: for i = n-1..1 it picks j ≤ i and swaps. So the j
 * sequence that yields a target permutation is computable by running the same loop forwards and,
 * at each i, asking "where is the card that must END UP at i?". Feeding those back as
 * `(j + 0.5) / (i + 1)` floors to exactly j — the half avoids betting the test on whether
 * `j / (i+1) * (i+1)` lands on the right side of an integer in binary floating point.
 *
 * This tests the real shuffle rather than routing around it, which matters: a deck the server
 * deals from is the one place where "the test used a different code path" would hide an unfair
 * game.
 */
function rngFor(target: readonly Card[]): () => number {
  const work = freshDeck();
  const js: number[] = [];
  for (let i = work.length - 1; i > 0; i--) {
    const wanted = target[i];
    if (wanted === undefined) throw new Error('rngFor: target must be a full 52-card deck');
    const j = work.findIndex((c, idx) => idx <= i && same(c, wanted));
    if (j < 0) throw new Error('rngFor: target is not a permutation of a fresh deck');
    const a = work[i];
    const b = work[j];
    if (a !== undefined && b !== undefined) {
      work[i] = b;
      work[j] = a;
    }
    js.push(j);
  }
  // Recorded top-down, consumed top-down.
  let n = 0;
  return () => {
    const i = target.length - 1 - n;
    const j = js[n] ?? 0;
    n++;
    return (j + 0.5) / (i + 1);
  };
}

const c = (rank: Card['rank'], suit: Card['suit'] = 'spades'): Card => ({ rank, suit });

/** A full deck whose first cards are the ones named — the rest follow in fresh-deck order. */
function stacked(...top: readonly Card[]): Card[] {
  const rest = freshDeck().filter((card) => !top.some((t) => same(t, card)));
  if (rest.length !== 52 - top.length) throw new Error('stacked: duplicate card named');
  return [...top, ...rest];
}

/** `deal` takes cards 0..3 as player1, dealer-up, player2, hole. */
const deal4 = (p1: Card, d1: Card, p2: Card, d2: Card): Card[] => stacked(p1, d1, p2, d2);

const seeded = (): Db => {
  const db = openDb(':memory:');
  upsertProfile(db, 'u1', { name: 'Ada', avatar: '👤', equipped: {} }, { now: 1 });
  upsertProfile(db, 'u2', { name: 'Bob', avatar: '👤', equipped: {} }, { now: 1 });
  return db;
};

const ok = (r: ReturnType<typeof dealHand>): { profile: ReturnType<typeof loadProfile>; hand: HandView; replayed: boolean } => {
  if (!r.ok) throw new Error(`expected ok, got refusal: ${r.error}`);
  return r.value;
};

const openWagers = (db: Db, uid: string): { wager_cents: number; hand_id: number | null }[] =>
  db
    .prepare('SELECT wager_cents, hand_id FROM wagers WHERE uid = ? AND settled_at IS NULL')
    .all(uid) as { wager_cents: number; hand_id: number | null }[];

/* ------------------------------------------------------------ the deal */

describe('dealHand', () => {
  it('deducts the wager from the LEDGER balance and opens a wager row', () => {
    const db = seeded();
    const hand = ok(dealHand(db, 'u1', { nonce: 'n1', wagerCents: 1_000 }, 1, rngFor(
      deal4(c('9'), c('7'), c('8'), c('6'))
    )));

    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS - 1_000);
    expect(hand.hand.phase).toBe('player');
    expect(openWagers(db, 'u1')).toEqual([{ wager_cents: 1_000, hand_id: hand.hand.handId }]);
  });

  it('refuses a wager the balance cannot cover, and deals nothing', () => {
    const db = seeded();
    const r = dealHand(db, 'u1', { nonce: 'n1', wagerCents: STARTING_BANKROLL_CENTS + 1 }, 1);

    expect(r.ok).toBe(false);
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS);
    // No orphan hand row. A `return` out of a better-sqlite3 transaction COMMITS — only a throw
    // rolls back — so "changed nothing" is earned by the write order, not given by the transaction.
    expect(db.prepare('SELECT COUNT(*) AS n FROM blackjack_hands').get()).toEqual({ n: 0 });
  });

  /**
   * A refused request must not consume the client's nonce either, or the honest retry that follows
   * an "insufficient funds" would take the replay branch, find no hand pinned to that nonce, and
   * turn a recoverable refusal into a dead end the player cannot get out of.
   */
  it('gives the nonce back on a refusal, so the same nonce can deal once affordable', () => {
    const db = seeded();
    expect(dealHand(db, 'u1', { nonce: 'n1', wagerCents: STARTING_BANKROLL_CENTS + 1 }, 1).ok).toBe(
      false
    );
    expect(db.prepare("SELECT COUNT(*) AS n FROM mutations WHERE uid = 'u1'").get()).toEqual({
      n: 0,
    });

    const retried = ok(dealHand(db, 'u1', { nonce: 'n1', wagerCents: 1_000 }, 2, rngFor(
      deal4(c('9'), c('7'), c('8'), c('6'))
    )));
    expect(retried.replayed).toBe(false);
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS - 1_000);
  });

  /**
   * THE v1 CHIP, one layer deeper than it has ever been checked. An ODD wager makes the 3:2
   * winnings a half-cent, and `floor(wager * 3 / 2)` is what keeps it an integer instead of a
   * float that a `parseInt` setter silently truncated in v1. The server computes this from its own
   * two cards — the request said 1001 and nothing else.
   */
  it('settles a dealt natural immediately and pays 2.5x, integer, on an odd wager', () => {
    const db = seeded();
    const hand = ok(dealHand(db, 'u1', { nonce: 'n1', wagerCents: 1_001 }, 1, rngFor(
      deal4(c('A'), c('9'), c('K'), c('7'))
    )));

    expect(hand.hand.phase).toBe('settled');
    expect(hand.hand.result).toBe('blackjack');

    // 3:2 on 1001 is 1501.5 exactly. The house rounds the half-cent DOWN — `floor(1001*3/2)` =
    // 1501 — and the total returned is the stake plus that: 2502, an integer. v1 computed
    // `bet * 2.5` in floats and pushed it through a `parseInt` setter, which is where the chip
    // went. The literal is spelled out rather than recomputed so this test would notice the
    // formula changing.
    const payout = 1_001 + Math.floor((1_001 * 3) / 2);
    expect(payout).toBe(2_502);
    expect(Number.isInteger(payout)).toBe(true);
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS - 1_001 + payout);
    // And the ledger row itself is an integer number of cents, not a float that rounded on read.
    const credit = db
      .prepare("SELECT delta_cents AS d FROM ledger WHERE uid = 'u1' AND reason = 'settle'")
      .get() as { d: number };
    expect(credit.d).toBe(2_502);

    // The stake is closed and the win is recorded — money, stats and XP moved together.
    expect(openWagers(db, 'u1')).toEqual([]);
    const profile = loadProfile(db, 'u1');
    expect(profile?.stats.blackjack).toEqual({ played: 1, won: 1, lost: 0, pushed: 0 });
    // `feat_natural` is detected by the server off `result === 'blackjack'`, not reported.
    expect(profile?.achievements.feat_natural).toBeDefined();
  });

  it('a hand still in play is not settled and holds its stake open', () => {
    const db = seeded();
    const hand = ok(dealHand(db, 'u1', { nonce: 'n1', wagerCents: 500 }, 1, rngFor(
      deal4(c('9'), c('7'), c('8'), c('6'))
    )));

    expect(hand.hand.result).toBeNull();
    expect(openWagers(db, 'u1')).toHaveLength(1);
    expect(loadProfile(db, 'u1')?.stats.blackjack).toBeUndefined();
  });
});

/* ------------------------------------------------------------- the move */

describe('playMove', () => {
  const dealt = (db: Db, deck: readonly Card[], wagerCents = 1_000): HandView =>
    ok(dealHand(db, 'u1', { nonce: 'deal', wagerCents }, 1, rngFor(deck))).hand;

  it('hit to bust pays nothing and records a loss', () => {
    const db = seeded();
    // 10 + 6, then the next card off the deck busts it.
    const deck = stacked(c('10'), c('7'), c('6'), c('5'), c('9', 'hearts'));
    const hand = dealt(db, deck);

    const after = ok(playMove(db, 'u1', { nonce: 'm1', handId: hand.handId, move: 'hit' }, 2)).hand;

    expect(after.phase).toBe('settled');
    expect(after.result).toBe('lose');
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS - 1_000);
    expect(openWagers(db, 'u1')).toEqual([]);
    expect(loadProfile(db, 'u1')?.stats.blackjack).toEqual({
      played: 1,
      won: 0,
      lost: 1,
      pushed: 0,
    });
  });

  /**
   * Stand runs the DEALER out on the server's own remaining deck. The expected payout is not a
   * literal: it is the shared `payoutCents(settle(...))` over the cards the response reveals, so
   * this asserts the server settled the hand the rulebook says it dealt — not that it matched a
   * number the test happened to agree with.
   */
  it('stand plays the dealer out and pays exactly what the shared rulebook says', () => {
    const db = seeded();
    const deck = stacked(c('10'), c('9', 'diamonds'), c('9'), c('7'), c('2', 'hearts'));
    const hand = dealt(db, deck);

    const after = ok(playMove(db, 'u1', { nonce: 'm1', handId: hand.handId, move: 'stand' }, 2)).hand;

    expect(after.phase).toBe('settled');
    // Settled, so the hole card is revealed and the dealer's whole hand is on the wire.
    const expected = payoutCents(settle(after.player, after.dealer), 1_000);
    expect(after.result).toBe(settle(after.player, after.dealer));
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS - 1_000 + expected);
  });

  it('a double takes a SECOND wager and settles against the doubled stake', () => {
    const db = seeded();
    const deck = stacked(c('6'), c('9'), c('5'), c('7'), c('9', 'hearts'));
    const hand = dealt(db, deck);

    const after = ok(playMove(db, 'u1', { nonce: 'm1', handId: hand.handId, move: 'double' }, 2)).hand;

    expect(after.doubled).toBe(true);
    expect(after.wagerCents).toBe(2_000);
    expect(after.phase).toBe('settled');

    // Two stakes were taken and BOTH closed with this hand.
    const wagers = db
      .prepare('SELECT wager_cents FROM wagers WHERE uid = ? AND hand_id = ?')
      .all('u1', hand.handId) as { wager_cents: number }[];
    expect(wagers).toEqual([{ wager_cents: 1_000 }, { wager_cents: 1_000 }]);
    expect(openWagers(db, 'u1')).toEqual([]);

    const expected = payoutCents(settle(after.player, after.dealer), 2_000);
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS - 2_000 + expected);
  });

  it('refuses a double the balance cannot cover, and changes NOTHING', () => {
    const db = seeded();
    // The whole bankroll is on the table, so a second stake of the same size is unaffordable.
    const deck = stacked(c('6'), c('9'), c('5'), c('7'), c('9', 'hearts'));
    const hand = dealt(db, deck, STARTING_BANKROLL_CENTS);
    const before = balanceOf(db, 'u1');

    const r = playMove(db, 'u1', { nonce: 'm1', handId: hand.handId, move: 'double' }, 2);

    expect(r.ok).toBe(false);
    expect(balanceOf(db, 'u1')).toBe(before);
    // No orphan stake, and the hand is untouched and still playable.
    expect(openWagers(db, 'u1')).toHaveLength(1);
    const row = db
      .prepare('SELECT settled FROM blackjack_hands WHERE id = ?')
      .get(hand.handId) as { settled: number };
    expect(row.settled).toBe(0);
  });

  it('refuses a move on a settled hand', () => {
    const db = seeded();
    const deck = stacked(c('10'), c('9', 'diamonds'), c('9'), c('7'), c('2', 'hearts'));
    const hand = dealt(db, deck);
    ok(playMove(db, 'u1', { nonce: 'm1', handId: hand.handId, move: 'stand' }, 2));

    const r = playMove(db, 'u1', { nonce: 'm2', handId: hand.handId, move: 'hit' }, 3);
    expect(r.ok).toBe(false);
  });

  /**
   * A hand id is a small sequential integer, so it is guessable by typing. Scoping the load to the
   * authenticated uid is what makes another account's hand a refusal rather than a peek at their
   * cards — and stops one account settling money into another's ledger.
   */
  it("refuses a hand id belonging to another account", () => {
    const db = seeded();
    const deck = stacked(c('10'), c('9', 'diamonds'), c('9'), c('7'), c('2', 'hearts'));
    const hand = dealt(db, deck);

    const r = playMove(db, 'u2', { nonce: 'm1', handId: hand.handId, move: 'stand' }, 2);

    expect(r.ok).toBe(false);
    expect(balanceOf(db, 'u2')).toBe(STARTING_BANKROLL_CENTS);
    // u1's hand is untouched — the stranger's move did not play it.
    const row = db
      .prepare('SELECT settled FROM blackjack_hands WHERE id = ?')
      .get(hand.handId) as { settled: number };
    expect(row.settled).toBe(0);
  });
});

/* ---------------------------------------------------------- the replays */

describe('replay safety', () => {
  it('a repeated deal nonce moves no money, deals no second hand, and replays the answer', () => {
    const db = seeded();
    const rng = rngFor(deal4(c('9'), c('7'), c('8'), c('6')));
    const first = ok(dealHand(db, 'u1', { nonce: 'n1', wagerCents: 1_000 }, 1, rng));
    const balance = balanceOf(db, 'u1');

    const second = ok(dealHand(db, 'u1', { nonce: 'n1', wagerCents: 1_000 }, 2));

    expect(second.replayed).toBe(true);
    expect(second.hand).toEqual(first.hand);
    expect(balanceOf(db, 'u1')).toBe(balance);
    expect(db.prepare('SELECT COUNT(*) AS n FROM blackjack_hands').get()).toEqual({ n: 1 });
    expect(openWagers(db, 'u1')).toHaveLength(1);
  });

  it('a repeated move nonce does not draw a second card or double a payout', () => {
    const db = seeded();
    const deck = stacked(c('10'), c('9', 'diamonds'), c('9'), c('7'), c('2', 'hearts'));
    const hand = ok(dealHand(db, 'u1', { nonce: 'deal', wagerCents: 1_000 }, 1, rngFor(deck))).hand;

    const first = ok(playMove(db, 'u1', { nonce: 'm1', handId: hand.handId, move: 'stand' }, 2));
    const balance = balanceOf(db, 'u1');

    const second = ok(playMove(db, 'u1', { nonce: 'm1', handId: hand.handId, move: 'stand' }, 3));

    expect(second.replayed).toBe(true);
    expect(second.hand).toEqual(first.hand);
    expect(balanceOf(db, 'u1')).toBe(balance);
    // One settle ledger row, one played stat — not two.
    expect(loadProfile(db, 'u1')?.stats.blackjack?.played).toBe(1);
  });

  it('a replayed hit does not stack a second card onto the hand', () => {
    const db = seeded();
    const deck = stacked(c('4'), c('9'), c('3'), c('7'), c('2', 'hearts'));
    const hand = ok(dealHand(db, 'u1', { nonce: 'deal', wagerCents: 1_000 }, 1, rngFor(deck))).hand;

    const first = ok(playMove(db, 'u1', { nonce: 'm1', handId: hand.handId, move: 'hit' }, 2));
    const second = ok(playMove(db, 'u1', { nonce: 'm1', handId: hand.handId, move: 'hit' }, 3));

    expect(first.hand.player).toHaveLength(3);
    expect(second.hand.player).toHaveLength(3);
    expect(second.replayed).toBe(true);
  });
});

/* ------------------------------------------------------------- the view */

describe('the projected view', () => {
  /**
   * THE "DONE WHEN" OF PHASE D. A player with devtools open cannot see what the server never sent,
   * and these are the two things it must never send: the hole card, and the deck.
   *
   * Asserted structurally — `'deck' in view` — rather than by comparing to a shape, because the
   * failure this guards against is a FIELD APPEARING, and a test that only checks the fields it
   * knows about would happily pass while a new one leaked the rest of the shoe.
   */
  it('hides the hole card and the deck while the hand is live', () => {
    const db = seeded();
    const view = ok(dealHand(db, 'u1', { nonce: 'n1', wagerCents: 1_000 }, 1, rngFor(
      deal4(c('9'), c('7'), c('8'), c('6'))
    ))).hand;

    expect(view.phase).toBe('player');
    expect(view.dealer).toHaveLength(1);
    expect(view.dealer[0]).toEqual(c('7')); // the up-card, and only the up-card
    expect(view.player).toHaveLength(2);
    expect('deck' in view).toBe(false);
    expect(JSON.stringify(view)).not.toContain('"deck"');

    // The server kept them — they are absent from the wire, not absent from the game.
    const row = db
      .prepare('SELECT state_json FROM blackjack_hands WHERE id = ?')
      .get(view.handId) as { state_json: string };
    const state = JSON.parse(row.state_json) as { deck: Card[]; dealer: Card[] };
    expect(state.dealer).toHaveLength(2);
    expect(state.deck).toHaveLength(48);
  });

  it('reveals the whole dealer hand once the hand is settled', () => {
    const db = seeded();
    const deck = stacked(c('10'), c('9', 'diamonds'), c('9'), c('7'), c('2', 'hearts'));
    const hand = ok(dealHand(db, 'u1', { nonce: 'deal', wagerCents: 1_000 }, 1, rngFor(deck))).hand;
    const after = ok(playMove(db, 'u1', { nonce: 'm1', handId: hand.handId, move: 'stand' }, 2)).hand;

    expect(after.phase).toBe('settled');
    expect(after.dealer.length).toBeGreaterThanOrEqual(2);
    expect('deck' in after).toBe(false);
  });

  it('viewOf never carries a deck at any phase', () => {
    const deck = shuffle(freshDeck(), rngFor(deal4(c('A'), c('9'), c('K'), c('7'))));
    // Straight at the projection, with a state that definitely holds cards.
    const view = viewOf(7, {
      deck,
      player: [c('A'), c('K')],
      dealer: [c('9'), c('7')],
      phase: 'player',
      wagerCents: 100,
      doubled: false,
      result: null,
      handId: 1,
    });
    expect(Object.keys(view).sort()).toEqual([
      'canDouble',
      'dealer',
      'doubled',
      'handId',
      'phase',
      'player',
      'result',
      'wagerCents',
    ]);
  });
});

/* ------------------------------------------------------------ the wire */

const cfg: ApiConfig = {
  port: 0,
  dbPath: ':memory:',
  firebaseProjectId: 'test',
  allowedOrigin: '*',
  authMode: 'firebase',
  allowInsecure: false,
};

const fakeVerifier: TokenVerifier = {
  verify: (token) => Promise.resolve(token),
};

const served = (): { app: ReturnType<typeof buildApp>; db: Db } => {
  const db = seeded();
  return { app: buildApp({ cfg, db, verifier: fakeVerifier }), db };
};

describe('the routes', () => {
  it('POST /blackjack/deal answers {profile, hand, replayed}', async () => {
    const { app, db } = served();
    const res = await request(app)
      .post('/blackjack/deal')
      .set('Authorization', 'Bearer u1')
      .send({ nonce: 'n1', wagerCents: 1_000 })
      .expect(200);

    expect(turnOf(res).replayed).toBe(false);
    expect(turnOf(res).hand.handId).toBeGreaterThan(0);
    // Against the RAW body, not the narrowed view: `HandView` has no `deck` property, so
    // `turnOf(res).hand.deck` is a compile error rather than an assertion — a stronger guarantee,
    // and precisely the one this phase is for. What is worth checking at runtime is that the
    // SERIALISED payload does not carry it under any name.
    expect(JSON.stringify(res.body)).not.toContain('deck');

    // THE STAKE IS ASSERTED THROUGH THE LEDGER, NOT THE BALANCE, because this route shuffles with
    // the real `Math.random` and roughly one deal in twenty-one is a natural — which settles
    // inside this same response and pays out, so the closing balance is legitimately one of three
    // numbers. Asserting `START - wager` here made the suite fail about 5% of runs, and a test
    // that is red one run in twenty is worse than no test: it trains you to re-run it.
    const bets = db
      .prepare("SELECT delta_cents FROM ledger WHERE uid = ? AND reason = 'bet'")
      .all('u1') as { delta_cents: number }[];
    expect(bets).toEqual([{ delta_cents: -1_000 }]);

    // And the balance still reconciles against what the hand actually did.
    const { phase, result } = turnOf(res).hand;
    // `result` is non-null exactly when the hand is settled — the type says `Result | null`, so
    // this reads both halves rather than asserting one away.
    expect(balanceOf(db, 'u1')).toBe(
      phase === 'settled' && result !== null
        ? STARTING_BANKROLL_CENTS - 1_000 + payoutCents(result, 1_000)
        : STARTING_BANKROLL_CENTS - 1_000
    );
  });

  /**
   * THE CLIENT CANNOT NAME A PAYOUT — and the proof is that there is nowhere to write one. This
   * body carries every field the old client-authoritative settle accepted; all of them are simply
   * never read, so the hand plays out exactly as an honest one would.
   */
  it('ignores a hostile body carrying payoutCents, outcome, result and cards', async () => {
    const { app, db } = served();
    const res = await request(app)
      .post('/blackjack/deal')
      .set('Authorization', 'Bearer u1')
      .send({
        nonce: 'n1',
        wagerCents: 1_000,
        payoutCents: 1_000_000,
        outcome: 'win',
        result: 'blackjack',
        player: [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'spades' }],
        deck: [],
      })
      .expect(200);

    // The bankroll moved by the wager and nothing else: no payout was credited on a deal that is
    // still in play, and a settled natural could at most have paid 2,500.
    const balance = balanceOf(db, 'u1');
    expect(balance).toBeLessThanOrEqual(STARTING_BANKROLL_CENTS + 1_500);
    expect(turnOf(res).profile.bankrollCents).toBe(balance);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE uid = 'u1' AND delta_cents = 1000000").get()
    ).toEqual({ n: 0 });
  });

  it('a hostile move body cannot settle a hand its way', async () => {
    const { app, db } = served();
    const dealt = await request(app)
      .post('/blackjack/deal')
      .set('Authorization', 'Bearer u1')
      .send({ nonce: 'n1', wagerCents: 1_000 })
      .expect(200);

    if (turnOf(dealt).hand.phase === 'settled') return; // a natural; nothing left to move on

    const res = await request(app)
      .post('/blackjack/move')
      .set('Authorization', 'Bearer u1')
      .send({
        nonce: 'n2',
        handId: turnOf(dealt).hand.handId,
        move: 'stand',
        payoutCents: 999_999,
        result: 'blackjack',
      })
      .expect(200);

    const expected = payoutCents(
      settle(turnOf(res).hand.player, turnOf(res).hand.dealer),
      1_000
    );
    expect(balanceOf(db, 'u1')).toBe(STARTING_BANKROLL_CENTS - 1_000 + expected);
  });

  it('400 on an unparseable body, 409 on a refusal', async () => {
    const { app } = served();
    await request(app)
      .post('/blackjack/deal')
      .set('Authorization', 'Bearer u1')
      .send({ wagerCents: 1_000 })
      .expect(400);

    await request(app)
      .post('/blackjack/move')
      .set('Authorization', 'Bearer u1')
      .send({ nonce: 'n1', handId: 1, move: 'fold' })
      .expect(400);

    // Well-formed, understood, and simply not true right now — that is a 409, not a 400.
    await request(app)
      .post('/blackjack/deal')
      .set('Authorization', 'Bearer u1')
      .send({ nonce: 'n1', wagerCents: STARTING_BANKROLL_CENTS + 1 })
      .expect(409);
  });

  it('401 without a token — the uid is never read from the body', async () => {
    const { app } = served();
    await request(app)
      .post('/blackjack/deal')
      .send({ nonce: 'n1', wagerCents: 1_000, uid: 'u1' })
      .expect(401);
  });
});
