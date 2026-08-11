/**
 * ENTERING A TABLE IS SITTING DOWN AT IT, AND A TABLE THAT WAS FULL WHEN YOU MADE IT DOES NOT ASK
 * YOU TO START IT. One rule with two halves, and this is the guard for both.
 *
 * THE DEFECT IT FENCES. Choosing a game meant answering every question it has — how many chairs,
 * who is in them, what a chair costs, what rules it is played under — in a modal that DREW the
 * resulting table as a seat preview, pressing Create underneath it, and then landing on a second
 * screen showing the same chairs again with a button on it. For an AI or hot-seat table that
 * button was a click on a foregone conclusion: `create` seats the host and fills the chairs in one
 * construction, so `canStart` was already true before the room had rendered once. And the other way
 * in was worse — a player joining by code or from the browser arrived holding nothing, looking at a
 * list of chairs, one of which they then had to identify and click, on a question with exactly one
 * sensible answer.
 *
 * Neither is a bug any static tool in this repo could see. Every function was correct; the flow was
 * the thing that was wrong, and a flow is not a type.
 *
 * WHAT CAN AND CANNOT BE CHECKED HERE. There is no DOM in this suite, so "the board appears without
 * an extra click" is not assertable and pretending otherwise would be the vacuous guard this repo
 * has caught on itself twice. What IS assertable is the two pure predicates the whole rule is built
 * out of — `autoSeatIndex` (which chair an arriver takes, and the three cases it refuses) and
 * `seatsAreReady` (whether a table is waiting for anything) — swept over the REAL registry, because
 * every failure here is a property of the games this app ships rather than of a fixture. Plus the
 * one composition fact that no unit test of either function can reach: that the ENTRANCE and the
 * START BUTTON ask the same function, which is what stops a preview promising a seated table and a
 * lobby asking for a click anyway.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  autoSeatIndex,
  claimSeat,
  firstClaimableIndex,
  plannedSeats,
  seatsAreReady,
  tableSizeChoices,
} from '@/system/room/seats';
import { fillForMode, roomModesOf, seatRangeFor } from '@/system/room/modes';
import { registry } from '@/games/registry';
import type { Seat } from '@/system/room/types';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const ME = 'uid-me';
const YOU = 'uid-you';
const HOST = { uid: ME, name: 'Ada' };

const human = (uid: string, name = uid): Seat => ({ kind: 'human', name, uid });
const ai = (name = 'CPU'): Seat => ({ kind: 'ai', name, uid: null });
const open = (): Seat => ({ kind: 'open', name: '', uid: null });

/** Every size a real game can actually be created at: the picker's rungs, or `min` when it draws none. */
const declaredSizes = (range: { min: number; max: number }): number[] => {
  const choices = tableSizeChoices(range);
  return choices.length > 0 ? choices : [range.min];
};

/** Every `.ts`/`.tsx` under a directory, recursively, as repo-ish `[path, source]` pairs. */
function sourcesUnder(dir: string): [path: string, src: string][] {
  const out: [string, string][] = [];
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) out.push(...sourcesUnder(full));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx'))
      out.push([full.slice(SRC.length), readFileSync(full, 'utf8')]);
  }
  return out;
}

describe('autoSeatIndex — arriving at a table sits you down at it', () => {
  it('takes the first open chair at a table that is waiting', () => {
    expect(
      autoSeatIndex({ seats: [human(ME), open(), open()], myUid: YOU, status: 'waiting' })
    ).toBe(1);
  });

  it('prefers an open chair to a bot one, and takes the bot one when that is all there is', () => {
    // OPEN BEFORE AI, inherited from `firstClaimableIndex` and asserted here because it is the
    // behaviour the rule promises: you fill an empty chair before you evict the house, so two
    // arrivals at a table with one open seat and one bot do not both displace a bot.
    expect(autoSeatIndex({ seats: [human(ME), ai(), open()], myUid: YOU, status: 'waiting' })).toBe(
      2
    );
    expect(autoSeatIndex({ seats: [human(ME), ai(), ai()], myUid: YOU, status: 'waiting' })).toBe(
      1
    );
  });

  it('refuses a chair once play has started, even though one is claimable', () => {
    // THE LOAD-BEARING REFUSAL. A live table started FULL, so the only claimable chair in one is an
    // `ai` seat — and that is a DEPARTED PLAYER'S HAND being driven on by the host, not an
    // invitation. Auto-walking into it hands a passer-by somebody else's cards, and at a betting
    // table somebody else's stake. Asserted as a PAIR (the chair exists, and is still not offered)
    // so the case cannot pass by accident on a table that simply had nowhere to sit.
    const seats: Seat[] = [human(ME), ai('Bob')];
    expect(firstClaimableIndex(seats)).toBe(1);
    expect(autoSeatIndex({ seats, myUid: YOU, status: 'playing' })).toBe(-1);
    // Same for the two statuses that are not a table you can join either.
    expect(autoSeatIndex({ seats, myUid: YOU, status: 'finished' })).toBe(-1);
    expect(autoSeatIndex({ seats, myUid: YOU, status: 'gone' })).toBe(-1);
  });

  it('refuses when I am already sitting down', () => {
    // Idempotence, and it is what lets the effect that calls this keep no memory of having fired:
    // a re-render, a StrictMode double mount and a reconnect replay all re-ask the question and all
    // get "you are already seated". Asserted with a chair genuinely free, so it is the seatedness
    // being read and not the absence of anywhere to go.
    const seats: Seat[] = [human(ME), human(YOU), open()];
    expect(firstClaimableIndex(seats)).toBe(2);
    expect(autoSeatIndex({ seats, myUid: YOU, status: 'waiting' })).toBe(-1);
  });

  it('leaves you standing at a full table rather than evicting anyone', () => {
    expect(
      autoSeatIndex({ seats: [human(ME), human('uid-c')], myUid: YOU, status: 'waiting' })
    ).toBe(-1);
    // A table with no seats at all is not a table. `[].findIndex` is -1 anyway, but a zero-chair
    // room is what a snapshot looks like before it loads, and answering "sit at chair 0" there
    // would fire a claim against a room that has not arrived.
    expect(autoSeatIndex({ seats: [], myUid: YOU, status: 'waiting' })).toBe(-1);
  });

  it('takes the NEXT chair after losing a race for one', () => {
    // THE RETRY IS THE SUBSCRIPTION. Two people reach for the last chair; the referee gives it to
    // one, and the loser's re-ask happens against the snapshot that made that true. No timer, no
    // backoff, no reconciliation — the same function on fresher seats.
    expect(
      autoSeatIndex({ seats: [human(ME), open(), open()], myUid: YOU, status: 'waiting' })
    ).toBe(1);
    expect(
      autoSeatIndex({
        seats: [human(ME), human('uid-fast'), open()],
        myUid: YOU,
        status: 'waiting',
      })
    ).toBe(2);
  });

  it('fills an online table as people arrive, one chair each, never the host’s', () => {
    // The composition neither unit case can reach: that arrivals CONVERGE. A predicate that
    // returned a claimable chair but not a fresh one each time would churn — three joiners fighting
    // over seat 1 while seats 2 and 3 stay empty — and every individual answer would look right.
    let seats: Seat[] = plannedSeats({ seatCount: 4, host: HOST, fill: 'none' });
    for (const uid of ['uid-b', 'uid-c', 'uid-d']) {
      const index = autoSeatIndex({ seats, myUid: uid, status: 'waiting' });
      expect(index).toBeGreaterThan(0);
      const claimed = claimSeat(seats, index, { uid, name: uid });
      expect(claimed.ok).toBe(true);
      if (claimed.ok) seats = claimed.seats;
    }
    expect(seatsAreReady(seats)).toBe(true);
    expect(new Set(seats.map((s) => s.uid)).size).toBe(4);
  });
});

describe('seatsAreReady — whether these seats are a game', () => {
  it('is a full table with a human in it', () => {
    expect(seatsAreReady([human(ME), ai(), ai()])).toBe(true);
    expect(seatsAreReady([human(ME), human(YOU)])).toBe(true);
  });

  it('is false while a chair is open', () => {
    expect(seatsAreReady([human(ME), open()])).toBe(false);
  });

  it('is false for a table of nothing but bots, and for no table at all', () => {
    // A room with no human in it has nobody to host or deal — and `[].every` is vacuously true, so
    // the empty array is the trap: without the guard, a snapshot that has not loaded reads as a
    // table ready to start.
    expect(seatsAreReady([ai(), ai()])).toBe(false);
    expect(seatsAreReady([])).toBe(false);
  });
});

describe('the entrance starts what it already seated', () => {
  it('auto-starts exactly the tables that came up full, for every real game and every way in', () => {
    // Read off the REAL registry and through the REAL `fillForMode`, not a re-spelled ternary: a
    // test that restated the mapping would be comparing a copy of the rule to the rule. What is
    // asserted is the whole rule in one line — a table is ready the moment it is created if and
    // only if its chairs were filled by the create, which is every way in except online.
    //
    // THE SIZES ARE THE MODE'S, through the REAL `seatRangeFor`, and that is not a detail: the
    // `iff` above is FALSE of a one-chair online table, which comes up full because there is no
    // second chair to leave open. Blackjack declares `min: 1` legitimately (its opponent is the
    // dealer, who takes no chair) and this case is what caught the consequence — "Play Online"
    // would have auto-started a solo hand at a table nobody could ever join. `seatRangeFor` floors
    // an online table at two, so the rule holds again by construction rather than by exception.
    let sawReady = false;
    let sawWaiting = false;
    for (const { manifest } of Object.values(registry)) {
      for (const mode of roomModesOf(manifest.modes)) {
        for (const n of declaredSizes(seatRangeFor(manifest.seats, mode))) {
          const planned = plannedSeats({ seatCount: n, host: HOST, fill: fillForMode(mode) });
          const ready = seatsAreReady(planned);
          expect(ready, `${manifest.id} ${mode} ${String(n)}`).toBe(mode !== 'online');
          if (ready) sawReady = true;
          else sawWaiting = true;
        }
      }
    }
    // Both answers have to actually OCCUR on the registry as it stands, or the sweep passes
    // vacuously the day every game ships online-only — the branch-nobody-takes failure.
    expect(sawReady).toBe(true);
    expect(sawWaiting).toBe(true);
  });

  it('asks ONE function whether a table is ready, in both places that ask', () => {
    // The composition fact, and the only form of it available without a DOM. `TableSetup` decides
    // whether to start the table it just made; `<Lobby>` decides whether to draw Start. Two
    // spellings of "is this table ready" could disagree, and the disagreement is the worst one on
    // offer: the preview promises a seated table, the create delivers a seated table, and the lobby
    // asks for a click anyway. So both must reach the answer through `seatsAreReady`, and the
    // re-expanded expression must be gone rather than merely unused.
    const setup = readFileSync(`${SRC}system/room/TableSetup.tsx`, 'utf8');
    const lobby = readFileSync(`${SRC}system/room/Lobby.tsx`, 'utf8');
    expect(setup).toContain('seatsAreReady(planned)');
    expect(lobby).toContain('seatsAreReady(seats)');
    expect(lobby).not.toMatch(/tableIsFull\(seats\)\s*&&/);
  });

  it('no game starts, or seats, its own table', () => {
    // The uniformity half, and the reason this is a rule rather than a fix to one screen: the same
    // shape as `tests/game-exit.test.ts` and `tests/game-result.test.ts`. WHERE the answer appears
    // and WHO has to agree already belong to the OS; WHEN a table starts and WHO is in it join
    // them. A game that flipped its own status or claimed its own chair would be re-deciding a
    // question the entrance already answered, and the seventh game would inherit it from the sixth.
    for (const [path, src] of sourcesUnder(`${SRC}games`)) {
      expect(src, path).not.toContain("setStatus('playing')");
      expect(src, path).not.toContain('autoSeatIndex');
    }
  });
});
