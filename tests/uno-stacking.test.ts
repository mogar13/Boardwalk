/**
 * STACKING — slice 2 of `plans/UNO_HOUSE_RULES.md`, and the first house rule the reducer actually
 * enforces. Slice 1 shipped the seam with every rule off; this is the one that changes what a card
 * is allowed to do.
 *
 * It has its own file rather than joining `tests/uno.test.ts` because it is a whole second rulebook
 * layered on the first, and the assertions that matter most are about the INTERACTION: a table with
 * `stack` off must play exactly the game it played yesterday (additivity), and a table with it on
 * must never reach a position with no legal move (termination). Neither is visible from inside a
 * test of the ordinary rules.
 *
 * Every case is driven through the REAL reducer rather than a hand-built "after" state — the house
 * rule for this game's tests, paid for by the log: a diff of two states written by the same hand
 * only proves that hand can subtract.
 */
import { describe, it, expect } from 'vitest';
import {
  type Card,
  type UnoGame,
  type UnoTable,
  answersStack,
  applyMove,
  canPlay,
  chooseAiMove,
  deal,
  describeMove,
  drawDebt,
  mustDraw,
  resolveHouseRules,
  tableOf,
  toPublic,
  DEFAULT_HOUSE_RULES,
  roundOver,
  winnerOf,
} from '@boardwalk/game-logic/games/uno';
import { linesFor } from '@/games/uno/log';

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let idc = 0;
const c = (color: Card['color'], kind: Card['kind'], value = -1): Card => ({
  id: `s${String((idc += 1))}`,
  color,
  kind,
  value,
});

/** The two rule sets under test, built through the shared resolver rather than as object literals. */
const STACK = resolveHouseRules({ stack: true });
const CROSS = resolveHouseRules({ stack: true, crossStack: true });

/**
 * A game with exact hands. Three cards a seat by default, deliberately: a seat that plays down to
 * ONE card triggers the UNO call or its +2 penalty, which moves cards for a reason that has nothing
 * to do with stacking and would make every count assertion below ambiguous.
 */
function game(hands: Card[][], topCard: Card, over: Partial<UnoGame> = {}): UnoGame {
  return {
    hands,
    deck: [
      c('red', 'number', 3),
      c('blue', 'number', 4),
      c('green', 'number', 5),
      c('yellow', 'number', 6),
      c('red', 'number', 7),
      c('blue', 'number', 8),
    ],
    discard: [topCard],
    color: topCard.color === 'wild' ? 'red' : topCard.color,
    turn: 0,
    direction: 1,
    calledUno: hands.map(() => false),
    finished: [],
    pendingDraw: 0,
    houseRules: DEFAULT_HOUSE_RULES,
    ...over,
  };
}

/** Filler that plays on nothing, so a hand holds a known number of cards and no accidental options. */
const junk = (): Card => c('green', 'number', 0);

const handSize = (g: UnoGame, seat: number): number => (g.hands[seat] ?? []).length;

describe('answersStack — what may be played onto a live stack', () => {
  const d2 = c('red', 'draw2');
  const w4 = c('wild', 'wild4');

  it('matches like for like, and a plain wild answers nothing', () => {
    expect(answersStack(c('blue', 'draw2'), d2, STACK)).toBe(true); // any colour, it is a +2
    expect(answersStack(c('wild', 'wild4'), w4, STACK)).toBe(true);
    expect(answersStack(c('wild', 'wild'), d2, STACK)).toBe(false); // draws nobody anything
    expect(answersStack(c('red', 'number', 5), d2, STACK)).toBe(false);
    expect(answersStack(c('red', 'skip'), d2, STACK)).toBe(false);
  });

  it('is ASYMMETRIC across the ladder, which is what makes a stack terminate', () => {
    // A +4 may answer a +2 when the table agreed to cross-stacking...
    expect(answersStack(c('wild', 'wild4'), d2, CROSS)).toBe(true);
    expect(answersStack(c('wild', 'wild4'), d2, STACK)).toBe(false); // ...and not otherwise
    // ...but a +2 may NEVER answer a +4, cross-stacking or not. If the smaller card could always
    // answer the bigger, a table holding enough +2s could keep one +4 alive indefinitely and the
    // debt would only ever grow — the tidy symmetric version is the one that does not terminate.
    expect(answersStack(c('red', 'draw2'), w4, CROSS)).toBe(false);
    expect(answersStack(c('red', 'draw2'), w4, STACK)).toBe(false);
  });
});

describe('canPlay — a live stack REPLACES the ordinary matching, it does not extend it', () => {
  const d2Top = c('red', 'draw2');
  const live = (rules = STACK, owed = 2): UnoTable => ({
    top: d2Top,
    color: 'red',
    pendingDraw: owed,
    houseRules: rules,
  });

  it('suspends colour and value matching while a debt stands', () => {
    // Every one of these is legal in the ordinary game on a red +2 and refused here.
    expect(canPlay(c('red', 'number', 5), live())).toBe(false); // colour
    expect(canPlay(c('blue', 'draw2'), live())).toBe(true); // the only kind that answers
    expect(canPlay(c('wild', 'wild'), live())).toBe(false); // a wild plays on ANYTHING, except this
    expect(canPlay(c('red', 'skip'), live())).toBe(false);
  });

  it('is the ordinary game again the moment the debt is paid', () => {
    const settled = { ...live(), pendingDraw: 0 };
    expect(canPlay(c('red', 'number', 5), settled)).toBe(true);
    expect(canPlay(c('wild', 'wild'), settled)).toBe(true);
  });

  it('reads cross-stacking, and reads it only through the resolver', () => {
    expect(canPlay(c('wild', 'wild4'), live(STACK))).toBe(false);
    expect(canPlay(c('wild', 'wild4'), live(CROSS))).toBe(true);
    // `crossStack` without `stack` is normalised away by `resolveHouseRules`, so there is no
    // position in which one read site could disagree with another about what it means.
    expect(resolveHouseRules({ crossStack: true }).crossStack).toBe(false);
  });
});

describe('drawDebt — the one reader of pendingDraw, and the two ways the raw field lies', () => {
  const top = c('red', 'draw2');
  const raw = (over: Record<string, unknown>): UnoTable => ({
    top,
    color: 'red',
    pendingDraw: 4,
    houseRules: STACK,
    ...over,
  });

  it('is nothing owed at a table that does not play stacking, whatever the counter says', () => {
    // The flags are the authority and the counter is subordinate. Anything else lets one stale
    // number collapse the legal set at a table that never agreed to play that way.
    expect(drawDebt(raw({ houseRules: DEFAULT_HOUSE_RULES }))).toBe(0);
    expect(drawDebt(raw({}))).toBe(4);
  });

  it('degrades rather than throws when the referee has never heard of the fields', () => {
    // THE DEPLOY ORDER, which is the case that reaches real players: the frontend ships on push and
    // the Pi by hand, so a new client WILL read a projection from an old referee. An absent bag is
    // `undefined.stack` — a TypeError that takes the board down — and an absent counter is a
    // comparison against `undefined`. Both must read as "no stack", which is also true: a server
    // that has never heard of stacking is not running any.
    expect(drawDebt(raw({ houseRules: undefined }))).toBe(0);
    expect(drawDebt(raw({ pendingDraw: undefined }))).toBe(0);
    expect(drawDebt(raw({ houseRules: undefined, pendingDraw: undefined }))).toBe(0);
  });

  it('floors garbage instead of putting it on the felt', () => {
    expect(drawDebt(raw({ pendingDraw: NaN }))).toBe(0);
    expect(drawDebt(raw({ pendingDraw: -3 }))).toBe(0);
    expect(drawDebt(raw({ pendingDraw: Infinity }))).toBe(0);
    expect(drawDebt(raw({ pendingDraw: 2.7 }))).toBe(2);
    expect(drawDebt(raw({ pendingDraw: '6' }))).toBe(0);
  });
});

describe('the reducer with stacking OFF — the additivity guard', () => {
  it('deals a draw-two immediately and skips the victim, exactly as it always has', () => {
    // The whole feature is meant to be invisible at a table that did not ask for it. This is the
    // assertion that says so: if it ever goes red, stacking has leaked into the default game.
    const d2 = c('red', 'draw2');
    const g = game(
      [
        [d2, junk(), junk()],
        [junk(), junk(), junk()],
        [junk(), junk(), junk()],
      ],
      c('red', 'number', 5)
    );
    const next = applyMove(g, 0, { type: 'play', cardId: d2.id }, seeded(1));
    expect(handSize(next, 1)).toBe(5); // dealt two, there and then
    expect(next.turn).toBe(2); // and skipped
    expect(next.pendingDraw).toBe(0); // no debt was ever created
  });
});

describe('the reducer with stacking ON', () => {
  const top = c('red', 'number', 5);

  /** Three seats of three, seat 0 holding `first`. */
  const table = (first: Card, rules = STACK, rest: Card[][] = []): UnoGame =>
    game(
      [
        [first, junk(), junk()],
        rest[0] ?? [junk(), junk(), junk()],
        rest[1] ?? [junk(), junk(), junk()],
      ],
      top,
      { houseRules: rules }
    );

  it('a draw-two deals NOTHING, owes two, and passes the turn ONE seat', () => {
    const d2 = c('red', 'draw2');
    const g = table(d2);
    const next = applyMove(g, 0, { type: 'play', cardId: d2.id }, seeded(1));
    expect(next.pendingDraw).toBe(2);
    expect(handSize(next, 1)).toBe(3); // untouched — the victim must get the chance to answer
    expect(next.turn).toBe(1);
  });

  it('accumulates as it goes round', () => {
    const a = c('red', 'draw2');
    const b = c('blue', 'draw2');
    const d = c('green', 'draw2');
    let g = table(a, STACK, [
      [b, junk(), junk()],
      [d, junk(), junk()],
    ]);
    g = applyMove(g, 0, { type: 'play', cardId: a.id }, seeded(1));
    expect(g.pendingDraw).toBe(2);
    g = applyMove(g, 1, { type: 'play', cardId: b.id }, seeded(1));
    expect(g.pendingDraw).toBe(4);
    g = applyMove(g, 2, { type: 'play', cardId: d.id }, seeded(1));
    expect(g.pendingDraw).toBe(6);
    expect(g.turn).toBe(0); // all the way round, and nobody has drawn a card yet
    expect(handSize(g, 0)).toBe(2);
  });

  it('cross-stacking raises a +2 stack to a +4 stack, and the ladder then locks', () => {
    const d2 = c('red', 'draw2');
    const w4 = c('wild', 'wild4');
    const d2b = c('blue', 'draw2');
    let g = table(d2, CROSS, [
      [w4, junk(), junk()],
      [d2b, junk(), junk()],
    ]);
    g = applyMove(g, 0, { type: 'play', cardId: d2.id }, seeded(1));
    g = applyMove(g, 1, { type: 'play', cardId: w4.id, chosenColor: 'green' }, seeded(1));
    expect(g.pendingDraw).toBe(6);
    // Seat 2 holds a +2 and the top is now a +4: refused, cross-stacking or not.
    expect(applyMove(g, 2, { type: 'play', cardId: d2b.id }, seeded(1))).toBe(g);
  });

  it('taking the stack pulls exactly what is owed, clears the debt and ends the turn', () => {
    const a = c('red', 'draw2');
    const b = c('blue', 'draw2');
    let g = table(a, STACK, [[b, junk(), junk()]]);
    g = applyMove(g, 0, { type: 'play', cardId: a.id }, seeded(1));
    g = applyMove(g, 1, { type: 'play', cardId: b.id }, seeded(1));
    expect(g.pendingDraw).toBe(4);
    const taken = applyMove(g, 2, { type: 'draw' }, seeded(1));
    expect(handSize(taken, 2)).toBe(7); // three, plus the four owed
    expect(taken.pendingDraw).toBe(0);
    expect(taken.turn).toBe(0); // one seat on — the skip, deferred into the take
  });

  it('rotates the table identically to the immediate version when nobody answers', () => {
    // The claim the design rests on: the skip has not vanished, it moved. A +2 nobody answers must
    // leave the same seat holding two more cards and the same seat on turn as a +2 that dealt on
    // the spot — otherwise stacking silently changes the turn order of a game that is not stacking.
    const d2 = c('red', 'draw2');
    const plain = game(
      [
        [d2, junk(), junk()],
        [junk(), junk(), junk()],
        [junk(), junk(), junk()],
      ],
      top
    );
    const immediate = applyMove(plain, 0, { type: 'play', cardId: d2.id }, seeded(1));

    const d2s = c('red', 'draw2');
    let stacked = table(d2s);
    stacked = applyMove(stacked, 0, { type: 'play', cardId: d2s.id }, seeded(1));
    stacked = applyMove(stacked, 1, { type: 'draw' }, seeded(1));

    expect(stacked.turn).toBe(immediate.turn);
    expect(handSize(stacked, 1)).toBe(handSize(immediate, 1));
  });

  it('clears a debt nobody will ever be asked to pay when the round is won', () => {
    // Going out on a +2 with a stack live: the turn has stopped and no seat will be asked for the
    // debt, so carrying it would leave the board announcing "+4" over a finished hand.
    const d2 = c('red', 'draw2');
    const g = table(d2, STACK);
    let played = applyMove(g, 0, { type: 'play', cardId: d2.id }, seeded(1)); // owed 2
    played = {
      ...played,
      hands: [[d2], (played.hands[1] ?? []).slice(), (played.hands[2] ?? []).slice()],
      turn: 0,
    };
    const won = applyMove(played, 0, { type: 'play', cardId: d2.id }, seeded(1));
    expect(winnerOf(won)).toBe(0);
    expect(won.pendingDraw).toBe(0);
  });
});

describe('the dry deck — the trap that would hang the table forever', () => {
  const top = c('red', 'number', 5);
  const owing = (deck: Card[]): UnoGame => {
    const d2 = c('red', 'draw2');
    const g = game(
      [
        [d2, junk(), junk()],
        [junk(), junk(), junk()],
      ],
      top,
      { houseRules: STACK, deck }
    );
    // Drive the debt through the reducer, then starve the deck — so the state under test is one the
    // rules actually produce rather than one this file asserted into existence.
    const after = applyMove(g, 0, { type: 'play', cardId: d2.id }, seeded(1));
    return { ...after, deck, discard: after.discard.slice(-1) };
  };

  it('clears the debt even when the deck comes up SHORT', () => {
    const g = { ...owing([c('red', 'number', 1)]), pendingDraw: 12 };
    const next = applyMove(g, 1, { type: 'draw' }, seeded(1));
    expect(handSize(next, 1)).toBe(4); // owed twelve, got the one that existed
    expect(next.pendingDraw).toBe(0); // and the debt is GONE, not the outstanding eleven
  });

  it('clears the debt and MOVES THE TURN when the deck yields nothing at all', () => {
    // The hang, stated exactly. With a debt outstanding the legal set has collapsed to cards that
    // answer the stack, so a victim who can neither answer nor draw has no legal move on a turn
    // only they can take. Returning the game unchanged — which is right with nothing owed — would
    // leave the table there for good.
    const g = owing([]);
    const next = applyMove(g, 1, { type: 'draw' }, seeded(1));
    expect(next).not.toBe(g);
    expect(next.pendingDraw).toBe(0);
    expect(next.turn).toBe(0);
    expect(handSize(next, 1)).toBe(3); // nothing to give
  });

  it('still returns the game UNCHANGED with nothing owed, which the auto-draw depends on', () => {
    // The other half of the asymmetry. The board arms its auto-draw on a key built from the event
    // seq, and a dry deck that returned a CHANGED state would move the seq and re-arm it — a timer
    // spinning on a pile that cannot serve it.
    const g = game(
      [
        [junk(), junk()],
        [junk(), junk()],
      ],
      c('red', 'number', 5),
      { deck: [] }
    );
    expect(applyMove(g, 0, { type: 'draw' }, seeded(1))).toBe(g);
  });
});

describe('mustDraw under a stack — the position the board takes for you', () => {
  const top = c('red', 'draw2');
  const owed = (hand: Card[]): UnoGame =>
    game([hand, [junk(), junk(), junk()]], top, { houseRules: STACK, pendingDraw: 4 });

  it('is true for a hand full of cards that would play in the ordinary game', () => {
    const g = owed([c('red', 'number', 5), c('wild', 'wild'), c('red', 'skip')]);
    expect(mustDraw(g.hands[0] ?? [], tableOf(g))).toBe(true);
  });

  it('is false for a hand that can answer', () => {
    const g = owed([c('blue', 'draw2'), junk()]);
    expect(mustDraw(g.hands[0] ?? [], tableOf(g))).toBe(false);
  });

  it('is still FALSE for an empty hand, debt or no debt', () => {
    // The trap `mustDraw` exists to close, re-asserted in the position that makes it worse: taking
    // a stack on behalf of a player whose private node has not arrived deals them six cards.
    const g = owed([]);
    expect(mustDraw([], tableOf(g))).toBe(false);
  });

  it('agrees with the REDUCER in both directions', () => {
    const stuck = owed([c('red', 'number', 5), c('wild', 'wild')]);
    expect(mustDraw(stuck.hands[0] ?? [], tableOf(stuck))).toBe(true);
    for (const card of stuck.hands[0] ?? []) {
      expect(applyMove(stuck, 0, { type: 'play', cardId: card.id, chosenColor: 'red' })).toBe(
        stuck
      );
    }
    expect(applyMove(stuck, 0, { type: 'draw' }, seeded(1))).not.toBe(stuck);

    const answerable = owed([c('blue', 'draw2'), junk()]);
    expect(mustDraw(answerable.hands[0] ?? [], tableOf(answerable))).toBe(false);
    const id = answerable.hands[0]?.[0]?.id ?? '';
    expect(applyMove(answerable, 0, { type: 'play', cardId: id }, seeded(1))).not.toBe(answerable);
  });
});

describe('the wire — the projection and the row it is stored in', () => {
  it('carries the debt, and normalises a match dealt before the field existed', () => {
    const d2 = c('red', 'draw2');
    const g = applyMove(
      game(
        [
          [d2, junk(), junk()],
          [junk(), junk(), junk()],
        ],
        c('red', 'number', 5),
        {
          houseRules: STACK,
        }
      ),
      0,
      { type: 'play', cardId: d2.id },
      seeded(1)
    );
    expect(toPublic(g, 1).pendingDraw).toBe(2);

    // A live `uno_matches` row written before this slice has neither field. It must project as
    // nothing owed rather than as a hole in the wire shape — RTDB drops an undefined child, so the
    // client would otherwise have to decide what a missing number means, which is the one thing
    // `drawDebt` exists to do in a single place.
    const legacy = { ...g, pendingDraw: undefined, houseRules: undefined } as unknown as UnoGame;
    expect(toPublic(legacy, 1).pendingDraw).toBe(0);
    expect(toPublic(legacy, 1).houseRules).toEqual(DEFAULT_HOUSE_RULES);
  });

  it('does not throw when the REDUCER meets that same legacy row', () => {
    // The reducer's first read of the rules bag arrived in this slice, so this is a new way for a
    // pre-house-rules match to take the dealer down mid-round.
    //
    // IT PLAYS A DRAW CARD, and that is the whole test. The first draft played a plain number and
    // passed while the reducer was still reading `game.houseRules.stack` raw — because only the
    // draw2/wild4 arm ever asks what a rule says, so a number card never reaches the line that
    // would throw. A totality test has to enter the branch it is about.
    const d2 = c('red', 'draw2');
    const g = game(
      [
        [d2, junk(), junk()],
        [junk(), junk(), junk()],
      ],
      c('red', 'number', 9)
    );
    const legacy = { ...g, pendingDraw: undefined, houseRules: undefined } as unknown as UnoGame;
    const next = applyMove(legacy, 0, { type: 'play', cardId: d2.id }, seeded(1));
    expect(next).not.toBe(legacy);
    // …and it plays it the way a match dealt before house rules existed WAS dealt: no stacking, so
    // the victim takes the two on the spot. Degrading to the ordinary game is the honest answer.
    expect(handSize(next, 1)).toBe(5);
    expect(next.pendingDraw).toBe(0);
  });

  it('survives the JSON round trip the match is stored through', () => {
    const d2 = c('red', 'draw2');
    const g = applyMove(
      game(
        [
          [d2, junk(), junk()],
          [junk(), junk(), junk()],
        ],
        c('red', 'number', 5),
        {
          houseRules: STACK,
        }
      ),
      0,
      { type: 'play', cardId: d2.id },
      seeded(1)
    );
    const restored = JSON.parse(JSON.stringify(g)) as UnoGame;
    expect(restored.pendingDraw).toBe(2);
    expect(drawDebt(tableOf(restored))).toBe(2);
  });
});

describe('the bots', () => {
  it('answer a stack when they hold an answer, at both tiers', () => {
    const d2 = c('red', 'draw2');
    const g = game(
      [
        [d2, junk(), junk()],
        [junk(), junk(), junk()],
      ],
      c('red', 'draw2'),
      {
        houseRules: STACK,
        pendingDraw: 2,
      }
    );
    for (const level of ['casual', 'sharp'] as const) {
      const move = chooseAiMove(g, 0, level, seeded(3));
      expect(move).toEqual({ type: 'play', cardId: d2.id, declareUno: false });
    }
  });

  it('take the stack rather than stalling when they cannot answer, at both tiers', () => {
    const g = game(
      [
        [c('red', 'number', 5), c('wild', 'wild')],
        [junk(), junk()],
      ],
      c('red', 'draw2'),
      {
        houseRules: STACK,
        pendingDraw: 6,
      }
    );
    for (const level of ['casual', 'sharp'] as const) {
      expect(chooseAiMove(g, 0, level, seeded(3)).type).toBe('draw');
    }
  });

  it('play whole dealt games to a WINNER with stacking on, at every tier', () => {
    // THE GUARD THAT MATTERS. A bot move the reducer refuses is a no-op on a turn only that bot can
    // take, and the table never moves again — and stacking adds two brand-new ways to reach one: a
    // collapsed legal set, and a debt that has to be payable. It also adds a way to make the game
    // UNWINNABLE without refusing anything, which is v1's `[5,5,5,5]` in another costume: hands
    // that grow faster than they empty. Only playing to a WINNER sees that.
    for (const rules of [STACK, CROSS]) {
      for (const level of ['casual', 'sharp'] as const) {
        for (const seed of [1, 7, 99]) {
          const rng = seeded(seed);
          let g = deal(4, rng, 0, rules);
          let guard = 0;
          while (!roundOver(g) && guard < 5000) {
            const before = g;
            const next = applyMove(g, g.turn, chooseAiMove(g, g.turn, level, rng), rng);
            expect(next).not.toBe(before); // a refusal returns the SAME object — the stall
            g = next;
            guard += 1;
          }
          expect(winnerOf(g)).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe('the log — a stacking table has nowhere else to say what is coming', () => {
  const top = c('red', 'number', 5);
  const stacking = (hands: Card[][], over: Partial<UnoGame> = {}): UnoGame =>
    game(hands, top, { houseRules: STACK, ...over });

  it('reports the running total, and reports nobody hit and nobody skipped', () => {
    // Under stacking a +2 deals nothing and skips nobody, so every field the log already had is
    // empty and it would print a played card with no hint that six are coming at somebody.
    const d2 = c('red', 'draw2');
    const before = stacking([
      [d2, junk(), junk()],
      [junk(), junk(), junk()],
      [junk(), junk(), junk()],
    ]);
    const after = applyMove(before, 0, { type: 'play', cardId: d2.id }, seeded(1));
    const e = describeMove(before, after, 0, { type: 'play', cardId: d2.id }, 4);
    expect(e.stacked).toBe(2);
    expect(e.victim).toBe(-1);
    expect(e.drew).toBe(0);
    expect(e.skipped).toBe(-1);
    expect(e.took).toBe(0);
  });

  it('counts the stack as it grows, off the RESULT rather than off the card played', () => {
    const a = c('red', 'draw2');
    const b = c('blue', 'draw2');
    let g = stacking([
      [a, junk(), junk()],
      [b, junk(), junk()],
      [junk(), junk(), junk()],
    ]);
    g = applyMove(g, 0, { type: 'play', cardId: a.id }, seeded(1));
    const after = applyMove(g, 1, { type: 'play', cardId: b.id }, seeded(1));
    expect(describeMove(g, after, 1, { type: 'play', cardId: b.id }, 5).stacked).toBe(4);
  });

  it('says how many a taker took, and that the debt is settled', () => {
    const d2 = c('red', 'draw2');
    let g = stacking([
      [d2, junk(), junk()],
      [junk(), junk(), junk()],
    ]);
    g = applyMove(g, 0, { type: 'play', cardId: d2.id }, seeded(1));
    const after = applyMove(g, 1, { type: 'draw' }, seeded(1));
    const e = describeMove(g, after, 1, { type: 'draw' }, 6);
    expect(e.took).toBe(2);
    expect(e.stacked).toBe(0);
  });

  it('counts an ordinary draw as one and a plain play as none', () => {
    const card = c('red', 'number', 9);
    const g = game(
      [
        [card, junk(), junk()],
        [junk(), junk(), junk()],
      ],
      top
    );
    const drew = applyMove(g, 0, { type: 'draw' }, seeded(1));
    expect(describeMove(g, drew, 0, { type: 'draw' }, 1).took).toBe(1);
    const played = applyMove(g, 0, { type: 'play', cardId: card.id }, seeded(1));
    expect(describeMove(g, played, 0, { type: 'play', cardId: card.id }, 1).took).toBe(0);
  });

  it('counts the UNO penalty as the two cards it is', () => {
    // `took` is recovered from a NET diff, and a play that costs one card and pays two back is the
    // case where a naive reading of that diff says "grew by one".
    const card = c('red', 'number', 9);
    const g = game(
      [
        [card, junk()],
        [junk(), junk(), junk()],
      ],
      top
    );
    const after = applyMove(g, 0, { type: 'play', cardId: card.id }, seeded(1));
    const e = describeMove(g, after, 0, { type: 'play', cardId: card.id }, 1);
    expect(e.penalty).toBe(true);
    expect(e.took).toBe(2);
  });

  it('says nothing at all about a REFUSED move', () => {
    const g = stacking(
      [
        [c('red', 'number', 5), junk()],
        [junk(), junk()],
      ],
      { pendingDraw: 4 }
    );
    const move = { type: 'play', cardId: g.hands[0]?.[0]?.id ?? '' } as const;
    const after = applyMove(g, 0, move, seeded(1));
    expect(after).toBe(g);
    const e = describeMove(g, after, 0, move, 9);
    expect(e.stacked).toBe(0);
    expect(e.took).toBe(0);
    expect(linesFor(e, ['A', 'B'])).toEqual([]);
  });
});

describe('the copy', () => {
  const names = ['Ada', 'Bo', 'Cy'];
  const top = c('red', 'number', 5);

  it('announces the running total once, as a table-wide line', () => {
    const d2 = c('red', 'draw2');
    const before = game(
      [
        [d2, junk(), junk()],
        [junk(), junk(), junk()],
        [junk(), junk(), junk()],
      ],
      top,
      {
        houseRules: STACK,
      }
    );
    const after = applyMove(before, 0, { type: 'play', cardId: d2.id }, seeded(1));
    const lines = linesFor(
      describeMove(before, after, 0, { type: 'play', cardId: d2.id }, 3),
      names
    );
    const stack = lines.filter((l) => l.text.includes('+2'));
    expect(stack).toHaveLength(1);
    expect(stack[0]?.seat).toBe(-1); // aimed at whoever is on turn, which the felt already shows
    expect(stack[0]?.system).toBe(true);
    expect(new Set(lines.map((l) => l.key)).size).toBe(lines.length); // React keys stay unique
  });

  it('says a stack was TAKEN rather than that a card was drawn', () => {
    // The log is the only place a hidden-hand game ever says what happened to somebody else's hand,
    // and "drew a card" for six is it lying about the one thing nobody can see for themselves.
    const d2 = c('red', 'draw2');
    let g = game(
      [
        [d2, junk(), junk()],
        [junk(), junk(), junk()],
      ],
      top,
      { houseRules: STACK }
    );
    g = applyMove(g, 0, { type: 'play', cardId: d2.id }, seeded(1));
    const after = applyMove(g, 1, { type: 'draw' }, seeded(1));
    const lines = linesFor(describeMove(g, after, 1, { type: 'draw' }, 7), names);
    expect(lines[0]?.text).toBe('Bo took the stack — 2 cards.');
  });

  it('still says "drew a card" for an ordinary draw', () => {
    const g = game(
      [
        [junk(), junk()],
        [junk(), junk()],
      ],
      c('red', 'number', 9)
    );
    const after = applyMove(g, 0, { type: 'draw' }, seeded(1));
    const lines = linesFor(describeMove(g, after, 0, { type: 'draw' }, 2), names);
    expect(lines[0]?.text).toBe('Ada drew a card.');
    expect(lines.some((l) => l.text.includes('Stack'))).toBe(false);
  });
});
