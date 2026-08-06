/**
 * RANKED PLACES — slice 3 of `plans/UNO_HOUSE_RULES.md`, and the house rule that changes the
 * ROTATION rather than the legal set.
 *
 * It has its own file for stacking's reason: it is a second rulebook layered on the first, and the
 * assertions that matter most are about the INTERACTION. Two of them carry the whole feature —
 *
 *   • ADDITIVITY. With `playToLast` off, a round must end the instant somebody goes out, exactly as
 *     it did yesterday. Every rotation rule below is now expressed in LIVE seats, so a mistake in
 *     any of them changes a game nobody asked to change.
 *   • TERMINATION. With it on, the table has to keep moving after 1st place and still reach a
 *     complete podium. A rotation that lands on a seat with no cards is a turn only that seat can
 *     take and nobody can — which is the illegal-bot-move stall wearing a different hat, and only a
 *     test that plays to a FULL podium sees it.
 *
 * Every case is driven through the REAL reducer rather than a hand-built "after" state — the house
 * rule for this game's tests, paid for by the log: a diff of two states written by the same hand
 * only proves that hand can subtract.
 */
import { describe, it, expect } from 'vitest';
import {
  type Card,
  type UnoGame,
  applyMove,
  chooseAiMove,
  deal,
  describeMove,
  drawDebt,
  isOut,
  liveSeats,
  placesOf,
  potSplit,
  resolveHouseRules,
  roundOver,
  seatAfterLive,
  tableOf,
  toPublic,
  winnerOf,
  DEFAULT_HOUSE_RULES,
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
  id: `p${String((idc += 1))}`,
  color,
  kind,
  value,
});

/** The rule under test, built through the shared resolver rather than as an object literal. */
const RANKED = resolveHouseRules({ playToLast: true });
const RANKED_STACK = resolveHouseRules({ playToLast: true, stack: true });

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

/** Play a named card from `seat`, declaring UNO so a hand going to one never picks up the +2. */
const play = (g: UnoGame, seat: number, card: Card): UnoGame =>
  applyMove(g, seat, { type: 'play', cardId: card.id, declareUno: true });

// ── the pure readers ────────────────────────────────────────────────────────────────────────────

describe('placesOf — the one reader of a list that may not be there', () => {
  it('reads a missing list as nobody out, because that is what an old referee is saying', () => {
    // THE DEPLOY ORDER, not a hypothetical: the frontend ships on push and the Pi by hand, so a
    // client meets a projection with no `finished` at all. `undefined.length` takes the board down;
    // "nobody has gone out" is both crash-free and true of a referee that cannot place anyone.
    expect(placesOf({ finished: undefined as unknown as number[] })).toEqual([]);
    expect(placesOf({ finished: 'nope' as unknown as number[] })).toEqual([]);
    expect(placesOf({ finished: 3 as unknown as number[] })).toEqual([]);
  });

  it('drops anything that is not a real seat index rather than trusting it', () => {
    // A `-1` smuggled in here would mark a seat that does not exist as out while `liveSeats` went on
    // counting every real one — the two readers disagreeing about who is still playing.
    expect(placesOf({ finished: [1, -1, 2.5, NaN, 0, 'x'] as unknown as number[] })).toEqual([
      1, 0,
    ]);
  });

  it('keeps a well-formed list in the order it was given, because the order IS the podium', () => {
    expect(placesOf({ finished: [2, 0, 1] })).toEqual([2, 0, 1]);
  });
});

describe('winnerOf / roundOver — who came first, and is anybody still playing', () => {
  it('answers -1 and false on a fresh deal', () => {
    const g = deal(4, seeded(1));
    expect(winnerOf(g)).toBe(-1);
    expect(roundOver(g)).toBe(false);
  });

  it('ordinarily, one placement ends the round', () => {
    const g = game([[], [junk()]], c('red', 'number', 5), { finished: [0] });
    expect(winnerOf(g)).toBe(0);
    expect(roundOver(g)).toBe(true);
  });

  it('playing for places, first place is settled and the round is NOT over', () => {
    // The two questions coming apart is the whole reason `winner` stopped being a field.
    const g = game([[], [junk()], [junk()]], c('red', 'number', 5), {
      finished: [0],
      houseRules: RANKED,
    });
    expect(winnerOf(g)).toBe(0);
    expect(roundOver(g)).toBe(false);
    expect(liveSeats(g)).toEqual([1, 2]);
    expect(isOut(g, 0)).toBe(true);
    expect(isOut(g, 1)).toBe(false);
  });

  it('reads a LEGACY match row, whose winner is the only record of who won', () => {
    // A round dealt before this slice is a real row on the Pi: `winner: 2`, no placement list. The
    // one thing that reads it is the query deciding who OPENS the next round, so losing it means
    // seat 0 leads instead of the player who just won, silently, at every table mid-evening when
    // the referee restarted.
    const legacy = { ...game([[], []], c('red', 'number', 5)), winner: 1 } as unknown as UnoGame;
    delete (legacy as { finished?: unknown }).finished;
    expect(winnerOf(legacy)).toBe(1);
    expect(roundOver(legacy)).toBe(true);

    const live = { ...game([[junk()], [junk()]], c('red', 'number', 5)), winner: -1 };
    delete (live as { finished?: unknown }).finished;
    expect(winnerOf(live as unknown as UnoGame)).toBe(-1);
    expect(roundOver(live as unknown as UnoGame)).toBe(false);
  });
});

describe('seatAfterLive — the rotation, once seats can leave it', () => {
  it('is the plain modular walk when nobody is out, so no existing rule changed meaning', () => {
    for (let from = 0; from < 5; from += 1) {
      for (const steps of [1, 2]) {
        for (const dir of [1, -1] as const) {
          expect(seatAfterLive(from, steps, dir, 5, [])).toBe((((from + dir * steps) % 5) + 5) % 5);
        }
      }
    }
  });

  it('counts LIVE seats only, and steps over the ones that are out', () => {
    expect(seatAfterLive(0, 1, 1, 4, [1])).toBe(2); // 1 is out, so one step lands on 2
    expect(seatAfterLive(0, 2, 1, 4, [1])).toBe(3); // two live steps: 2 then 3
    expect(seatAfterLive(0, 1, -1, 4, [3])).toBe(2);
  });

  it('starts from a seat that is ITSELF out — the ordinary case, not an edge', () => {
    // A player who goes out on their own turn is placed by the same move that then has to advance
    // past them, so a dead starting point has to cost nothing.
    expect(seatAfterLive(1, 1, 1, 4, [1])).toBe(2);
    expect(seatAfterLive(1, 2, 1, 4, [1, 2])).toBe(0); // over 2 (out) → 3, then 0
  });

  it('degrades instead of looping when no seat is live', () => {
    // Only reachable once the round is over, where nothing reads the turn — but looping forever
    // looking for a live seat is the one way this function could take a table down.
    expect(seatAfterLive(2, 1, 1, 3, [0, 1, 2])).toBe(2);
    expect(seatAfterLive(2, 1, 1, 0, [])).toBe(2);
    expect(seatAfterLive(2, 0, 1, 3, [])).toBe(2);
  });
});

// ── the reducer ─────────────────────────────────────────────────────────────────────────────────

describe('additivity — a table that did not ask for places plays exactly the game it always did', () => {
  it('ends the round on the FIRST player out, with a podium of one', () => {
    const g = game([[c('red', 'number', 5)], [junk()], [junk()]], c('red', 'number', 9));
    const next = play(g, 0, g.hands[0]![0]!);
    expect(placesOf(next)).toEqual([0]);
    expect(roundOver(next)).toBe(true);
    expect(winnerOf(next)).toBe(0);
    expect(next.turn).toBe(0); // no advance after a win
    expect(applyMove(next, 1, { type: 'draw' })).toBe(next); // and nothing more happens
  });

  it('leaves the straggler UNPLACED — the ordinary game has no 2nd place to record', () => {
    const g = game([[c('red', 'number', 5)], [junk()]], c('red', 'number', 9));
    expect(placesOf(play(g, 0, g.hands[0]![0]!))).toEqual([0]);
  });

  it('a reverse still acts as a skip at two SEATED players when nobody is out', () => {
    const g = game([[c('red', 'reverse'), junk()], [junk()]], c('red', 'number', 9));
    const next = play(g, 0, g.hands[0]![0]!);
    expect(next.turn).toBe(0); // heads-up reverse = you play again
    expect(next.direction).toBe(-1);
  });
});

describe('playing for places — the round keeps going, and the podium fills up', () => {
  it('places 1st and hands the turn to the next LIVE seat', () => {
    const g = game([[c('red', 'number', 5)], [junk()], [junk()], [junk()]], c('red', 'number', 9), {
      houseRules: RANKED,
    });
    const next = play(g, 0, g.hands[0]![0]!);
    expect(placesOf(next)).toEqual([0]);
    expect(roundOver(next)).toBe(false);
    expect(winnerOf(next)).toBe(0); // decided…
    expect(toPublic(next, 0).winner).toBe(-1); // …but the wire does not say "over" yet
    expect(next.turn).toBe(1);
  });

  it('never lands the turn on a seat that has gone out', () => {
    // Seat 1 is out; seat 0 plays a plain card, so the turn moves ONE live seat — over 1, onto 2.
    const g = game(
      [[c('red', 'number', 5), junk()], [], [junk()], [junk()]],
      c('red', 'number', 9),
      {
        finished: [1],
        houseRules: RANKED,
      }
    );
    expect(play(g, 0, g.hands[0]![0]!).turn).toBe(2);
  });

  it('deals a draw-two to the next LIVE seat, not to an empty hand', () => {
    // Dealing two into a hand the projection reports as empty is a seat that is out and holding
    // cards — a position with no rule to resolve it.
    const g = game(
      [[c('red', 'draw2'), junk()], [], [junk(), junk()], [junk()]],
      c('red', 'number', 9),
      { finished: [1], houseRules: RANKED }
    );
    const next = play(g, 0, g.hands[0]![0]!);
    expect(next.hands[1]).toHaveLength(0);
    expect(next.hands[2]).toHaveLength(4); // 2 held + 2 dealt
    expect(next.turn).toBe(3); // and 2 is skipped
  });

  it('A REVERSE ACTS AS A SKIP AT TWO LIVE PLAYERS, NOT TWO SEATED ONES', () => {
    // The headline rotation rule, and the one UNO_POT §2 named as the reason raise/call/fold was
    // deferred: a folded seat leaves the rotation the same way a finished one does. Four chairs,
    // two of them empty-handed — a reverse must bounce straight back to the player who laid it.
    const g = game([[c('red', 'reverse'), junk()], [], [], [junk()]], c('red', 'number', 9), {
      finished: [1, 2],
      houseRules: RANKED,
    });
    const next = play(g, 0, g.hands[0]![0]!);
    expect(next.direction).toBe(-1);
    expect(next.turn).toBe(0);
    // Falsified by counting SEATS: four chairs is not two, so `steps` would be 1 and the turn would
    // land on seat 3 — a legal-looking table playing the wrong rotation.
  });

  it('places the straggler LAST without making them play a hand against nobody', () => {
    const g = game([[junk()], [c('red', 'number', 5)], [junk(), junk()]], c('red', 'number', 9), {
      finished: [2],
      houseRules: RANKED,
      turn: 1,
    });
    const next = play(g, 1, g.hands[1]![0]!);
    expect(placesOf(next)).toEqual([2, 1, 0]); // 2 already out, 1 goes out, 0 is placed last
    expect(next.hands[0]).toHaveLength(1); // still holding a card — never asked to play it
    expect(roundOver(next)).toBe(true);
    expect(winnerOf(next)).toBe(2);
  });

  it('is over at heads-up exactly when the ordinary game is, so a 2-seat table is unchanged', () => {
    const g = game([[c('red', 'number', 5)], [junk()]], c('red', 'number', 9), {
      houseRules: RANKED,
    });
    const next = play(g, 0, g.hands[0]![0]!);
    expect(roundOver(next)).toBe(true);
    expect(placesOf(next)).toEqual([0, 1]);
  });

  it('refuses every move once the podium is complete', () => {
    const g = game([[], [junk()], []], c('red', 'number', 9), {
      finished: [0, 2, 1],
      houseRules: RANKED,
      turn: 1,
    });
    expect(applyMove(g, 1, { type: 'draw' })).toBe(g);
  });
});

describe('places × stacking — the two rules that both change what the next seat may do', () => {
  it('passes a live debt PAST first place to the next live seat', () => {
    // Going out on a +2 does not cancel it: the stack is aimed at whoever is on turn, and playing
    // for places there still is one. (Ordinarily the round ends here, which is the next case.)
    const g = game(
      [[c('red', 'draw2')], [c('blue', 'draw2'), junk()], [junk(), junk()]],
      c('red', 'number', 9),
      { houseRules: RANKED_STACK }
    );
    const next = play(g, 0, g.hands[0]![0]!);
    expect(placesOf(next)).toEqual([0]);
    expect(roundOver(next)).toBe(false);
    expect(drawDebt(tableOf(next))).toBe(2);
    expect(next.turn).toBe(1);
    // …and seat 1 can still answer it, which is the position being live at all.
    const answered = play(next, 1, next.hands[1]![0]!);
    expect(drawDebt(tableOf(answered))).toBe(4);
  });

  it('clears a debt nobody will be asked to pay once the round IS over', () => {
    const g = game([[c('red', 'draw2')], [junk()]], c('red', 'number', 9), {
      houseRules: RANKED_STACK,
    });
    const next = play(g, 0, g.hands[0]![0]!);
    expect(roundOver(next)).toBe(true);
    expect(drawDebt(tableOf(next))).toBe(0);
  });
});

// ── the wire, and what the table says ───────────────────────────────────────────────────────────

describe('the projection', () => {
  it('carries the podium and survives the JSON round trip a match is stored through', () => {
    const g = game([[], [junk()], [junk()]], c('red', 'number', 5), {
      finished: [0],
      houseRules: RANKED,
    });
    const back = JSON.parse(JSON.stringify(g)) as UnoGame;
    expect(placesOf(back)).toEqual([0]);
    expect(roundOver(back)).toBe(false);
    expect(toPublic(back, 1).finished).toEqual([0]);
  });

  it('normalises a match dealt before places existed to an empty podium, not a hole', () => {
    const legacy = { ...game([[junk()], [junk()]], c('red', 'number', 5)), winner: -1 };
    delete (legacy as { finished?: unknown }).finished;
    const pub = toPublic(legacy, 0);
    expect(pub.finished).toEqual([]);
    expect(pub.winner).toBe(-1);
  });
});

describe('the move log — going out and winning came apart', () => {
  const names = ['Ada', 'Bob', 'Cy', 'Dee'];

  it('says "went out and WINS" in the ordinary game, exactly as it always did', () => {
    const g = game([[c('red', 'number', 5)], [junk()], [junk()]], c('red', 'number', 9));
    const after = play(g, 0, g.hands[0]![0]!);
    const event = describeMove(g, after, 0, { type: 'play', cardId: g.hands[0]![0]!.id }, 1);
    expect(event.place).toBe(1);
    expect(event.winner).toBe(0);
    expect(linesFor(event, names).map((l) => l.text)).toContain('Ada went out and WINS!');
  });

  it('reports a PLACE, and no winner, while a ranked round is still running', () => {
    const g = game([[c('red', 'number', 5)], [junk()], [junk()], [junk()]], c('red', 'number', 9), {
      houseRules: RANKED,
    });
    const move = { type: 'play' as const, cardId: g.hands[0]![0]!.id };
    const after = play(g, 0, g.hands[0]![0]!);
    const event = describeMove(g, after, 0, move, 1);
    expect(event.place).toBe(1);
    expect(event.winner).toBe(-1);
    const texts = linesFor(event, names).map((l) => l.text);
    expect(texts).toContain('Ada goes out — 1st place.');
    expect(texts.some((t) => t.includes('WINS'))).toBe(false);
  });

  it('credits the ACTOR, not the straggler, on the move that ends a ranked round', () => {
    // The end places TWO seats at once. Taking the last entry would report the player who went out
    // as having come last — the one place a diff can quietly name the wrong person.
    const g = game([[junk()], [c('red', 'number', 5)], [junk(), junk()]], c('red', 'number', 9), {
      finished: [2],
      houseRules: RANKED,
      turn: 1,
    });
    const move = { type: 'play' as const, cardId: g.hands[1]![0]!.id };
    const after = play(g, 1, g.hands[1]![0]!);
    const event = describeMove(g, after, 1, move, 4);
    expect(placesOf(after)).toEqual([2, 1, 0]);
    expect(event.place).toBe(2); // Bob came SECOND; Ada was placed last
    expect(event.winner).toBe(2); // and Cy, three moves ago, took it
    const texts = linesFor(event, names).map((l) => l.text);
    expect(texts).toContain('Bob goes out — 2nd place.');
    expect(texts).toContain('Round over — Cy took it.');
  });

  it('never announces a seat that is OUT as skipped', () => {
    // The skip is read from the live rotation, so a player with no cards is not reported as having
    // lost a turn they were never going to take.
    const g = game([[c('red', 'skip'), junk()], [], [junk()], [junk()]], c('red', 'number', 9), {
      finished: [1],
      houseRules: RANKED,
    });
    const move = { type: 'play' as const, cardId: g.hands[0]![0]!.id };
    const after = play(g, 0, g.hands[0]![0]!);
    const event = describeMove(g, after, 0, move, 2);
    expect(event.skipped).toBe(2);
    expect(linesFor(event, names).map((l) => l.text)).toContain('Cy is skipped!');
  });

  it('says nothing at all for a refused move', () => {
    const g = game([[junk()], [junk()]], c('red', 'number', 9), { houseRules: RANKED });
    const move = { type: 'play' as const, cardId: 'nope' };
    expect(describeMove(g, applyMove(g, 0, move), 0, move, 3).action).toBe('deal');
  });
});

// ── termination ─────────────────────────────────────────────────────────────────────────────────

describe('a ranked table finishes — every seat placed, at both tiers', () => {
  it('plays whole dealt games to a COMPLETE podium, with every move changing the state', () => {
    // The stall guard, and it matters more here than anywhere: after 1st place the rotation is
    // running on a shrinking set of seats, and a step that lands on an empty hand is a turn only
    // that seat can take and nobody can. A test that stops at the first winner cannot see it.
    for (const level of ['casual', 'sharp'] as const) {
      for (const rules of [{ playToLast: true }, { playToLast: true, stack: true }]) {
        for (const seats of [3, 5]) {
          for (const seed of [3, 17]) {
            const rng = seeded(seed);
            let g = deal(seats, rng, 0, rules);
            let guard = 0;
            while (!roundOver(g) && guard < 8000) {
              const before = g;
              const next = applyMove(g, g.turn, chooseAiMove(g, g.turn, level, rng), rng);
              expect(next).not.toBe(before); // a refusal returns the SAME object — the stall
              // AND THE TURN NEVER LANDS ON AN EMPTY HAND. That is a turn only that seat can take
              // and nobody can, and it is the stall the rotation rewrite could reintroduce without
              // any single move ever being refused.
              if (!roundOver(next)) expect(isOut(next, next.turn)).toBe(false);
              // The podium only ever grows, and never re-places anyone.
              expect(placesOf(next).length).toBeGreaterThanOrEqual(placesOf(before).length);
              g = next;
              guard += 1;
            }
            expect(roundOver(g)).toBe(true);
            expect(placesOf(g)).toHaveLength(seats); // every seat placed, in order
            expect(new Set(placesOf(g)).size).toBe(seats); // and nobody placed twice
            expect(liveSeats(g)).toEqual([]);
          }
        }
      }
    }
  });
});

// ── the money ───────────────────────────────────────────────────────────────────────────────────

describe('potSplit — how a pot splits across ranked places', () => {
  it('is winner-takes-all at one, two and three payers, so today’s tables do not move', () => {
    // `floor(k/2)` is 1 for all three. A house rule that re-prices a game nobody asked to re-price
    // is the default-change mistake in a different hat.
    expect(potSplit(5000, 1)).toEqual([5000]);
    expect(potSplit(5000, 2)).toEqual([5000, 0]);
    expect(potSplit(7500, 3)).toEqual([7500, 0, 0]);
  });

  it('pays the top HALF, on a descending ladder, and nothing below it', () => {
    expect(potSplit(3000, 4)).toEqual([2000, 1000, 0, 0]);
    expect(potSplit(6000, 6)).toEqual([3000, 2000, 1000, 0, 0, 0]);
    // Placing badly costs you: a ladder that paid every position would hand last place a rebate for
    // losing, which is a softer version of the faucet the plan's §4 exists to refuse.
    expect(potSplit(6000, 7)[6]).toBe(0);
  });

  it('CONSERVES THE POT EXACTLY — every table size, every stake, remainder to first', () => {
    // The one thing a ledger cannot absorb. A percentage split that rounds each share independently
    // either mints a cent or loses one, on every single hand.
    for (let places = 1; places <= 7; places += 1) {
      for (const pot of [0, 1, 2, 7, 99, 2500, 7501, 100_000, 123_457]) {
        const split = potSplit(pot, places);
        expect(split).toHaveLength(places);
        expect(split.reduce((a, b) => a + b, 0)).toBe(pot);
        for (const share of split) {
          expect(Number.isInteger(share)).toBe(true);
          expect(share).toBeGreaterThanOrEqual(0);
        }
        // Descending: first place is never beaten by a later one, which is what makes it a ladder.
        for (let i = 1; i < split.length; i += 1) {
          expect(split[i - 1]!).toBeGreaterThanOrEqual(split[i]!);
        }
      }
    }
  });

  it('pays nothing rather than writing a nonsense ledger row', () => {
    expect(potSplit(5000, 0)).toEqual([]);
    expect(potSplit(5000, -2)).toEqual([]);
    expect(potSplit(5000, NaN)).toEqual([]);
    expect(potSplit(-5000, 2)).toEqual([0, 0]);
    expect(potSplit(NaN, 2)).toEqual([0, 0]);
    expect(potSplit(2500.7, 2)).toEqual([2500, 0]); // integer cents, floored like every stake
  });
});
