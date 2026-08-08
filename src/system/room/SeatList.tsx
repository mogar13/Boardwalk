import { Button, Card, useToast } from '@/ui';
import { useRoom } from '@/system/room/useRoom';
import { useSeats } from '@/system/room/useSeats';
import { aiSeatName, localSeatName } from '@/system/room/seats';

/**
 * The seat grid — the universal multiplayer primitive, made visible. Every seat is one of three
 * kinds and the actions available depend on who you are, not on a mode: you can take an open or a
 * bot seat, you can move to a different one before the deal, you can hand yours to the house once
 * play has started, and the host can drop a bot into an open chair or clear one. There is no
 * "hot-seat view" vs "online view"; there is one seat array drawn one way.
 *
 * Since `useAutoSeat`, this grid is no longer how you GET a seat — arriving at a table takes the
 * first claimable chair for you, and what is left here is changing your mind about which one. That
 * is why the controls below are asymmetric about `status` in a way they did not used to be: before
 * the deal a chair is furniture you may rearrange, and after it a chair is somebody's hand.
 */

const seatLabel = (kind: 'open' | 'human' | 'ai'): string =>
  kind === 'open' ? 'Open' : kind === 'ai' ? 'CPU' : 'Player';

/**
 * `allowAi` — whether this game can be played against the house. A CPU seat is only ever legal for a
 * game that declares an `'ai'` mode and therefore ships a driver for it; adding a bot to a game with
 * no driver (Chess) would seat an occupant whose turn never comes and stall the table. So the lobby
 * gates its "Add CPU" control on the manifest, the same way it filters `'solo'` out of its mode
 * buttons — the fix Chess surfaced, kept in the OS rather than worked around per game.
 */
export interface SeatListProps {
  readonly allowAi: boolean;
}

export function SeatList({ allowAi }: SeatListProps) {
  const { seats, claim, release, setAi, isHost, myId, status } = useRoom();
  const { mySeatIndex, sharedScreen } = useSeats();
  const toast = useToast();
  const inLobby = status === 'waiting';

  /**
   * SIT, OR MOVE — one function, because they are one action with different starting points.
   *
   * Claiming can lose a race for an open chair; the repo returns `{ ok: false, 'Seat taken.' }`.
   * Without surfacing that, the click did nothing visible — the whole `ClaimResult` had no consumer.
   *
   * A MOVE IS CLAIM-THEN-RELEASE, strictly in that order. Since arriving seats you automatically,
   * "sit somewhere else" is now the ordinary way to choose a chair, and the naive spelling — free
   * my seat, then take the other — is the one that can leave you with NOTHING: between the two
   * writes the chair you vacated is claimable, and the whole reason you are moving is that other
   * people are picking chairs at the same time. Claiming first means a lost race costs you nothing;
   * you keep the seat you had and the toast says why.
   *
   * The window where you briefly hold two chairs is one round trip, in `waiting`, before any deal —
   * and antes are taken at the DEAL, off the seats as they stand then, so it cannot cost a stake.
   * `sharedScreen` is excluded from the release because holding several seats is what hot-seat IS.
   */
  const sit = (index: number, name?: string): void => {
    const from = mySeatIndex;
    void (async () => {
      const claimed = await claim(index, name);
      if (!claimed.ok) {
        toast.error(claimed.error);
        return;
      }
      if (!sharedScreen && from !== -1 && from !== index) await release(from, 'open');
    })();
  };

  /**
   * ONE BUTTON INSTEAD OF SIX (plans/done/GAME_LAUNCH_MODAL.md §5.4). An AI table comes up seated from
   * `create`, so this is the ESCAPE HATCH for the case that deliberately does not: an online table
   * nobody joined, which is what makes §5.3's decline ("a public table that comes up full starts
   * before anyone can walk up to it") cheap rather than a limitation.
   *
   * A loop of `setAi` and not a wire field, because unlike `create` there is nothing atomic to
   * preserve: the chairs are already open and visible, and a human who claims one mid-loop simply
   * keeps it — `setAi` writes the seat it is given and the next snapshot draws whoever won. Each
   * chair is named by `aiSeatName`, the same function `plannedSeats` previewed the table with and
   * the same one the per-seat control below writes, so a table filled here and a table that came
   * up filled call the same chair the same thing.
   */
  const fillWithCpus = (): void => {
    void (async () => {
      for (const [i, seat] of seats.entries()) {
        if (seat.kind === 'open') await setAi(i, aiSeatName(i));
      }
    })();
  };
  const openChairs = seats.filter((s) => s.kind === 'open').length;

  return (
    <Card className="flex flex-col gap-2 p-4">
      <h3 className="font-display text-bw-muted text-xs font-semibold tracking-[0.2em] uppercase">
        Seats
      </h3>
      {seats.map((seat, i) => {
        const isMine = seat.kind === 'human' && seat.uid === myId;
        return (
          <div
            key={i}
            className="border-bw-line/60 flex items-center justify-between gap-3 border-b py-2 last:border-b-0"
          >
            <span className="flex items-center gap-2 text-sm">
              <span className="font-display text-bw-muted text-[0.6rem] tracking-[0.2em] uppercase">
                {seatLabel(seat.kind)}
              </span>
              <span className={isMine ? 'text-secondary font-semibold' : 'text-base-content'}>
                {seat.kind === 'open' ? '—' : seat.name || '…'}
                {isMine ? ' (you)' : ''}
              </span>
            </span>

            <span className="flex gap-2">
              {/* TAKING a chair when you hold none. Online/vs-AI: one account, one seat
                  (`mySeatIndex === -1`). Hot-seat: one screen seats several LOCAL humans, so the
                  one-seat gate lifts and each extra local player gets its own label. `sharedScreen`
                  is the collapsed mode-boolean (see `useSeats`). Offered at ANY status on purpose —
                  claiming a bot's chair mid-game is drop-IN, v1's best multiplayer idea and the
                  reason `releaseSeat` hands a leaver's seat to an AI rather than emptying it. */}
              {seat.kind !== 'human' && (sharedScreen || mySeatIndex === -1) && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    sit(i, sharedScreen ? localSeatName(i) : undefined);
                  }}
                >
                  Sit
                </Button>
              )}
              {/* MOVING, once something has already sat you down. `inLobby` only, and that is not
                  symmetry with the control above: mid-game every claimable chair is a departed
                  player's hand being driven on, so "move here" would mean abandoning your own game
                  to walk into somebody else's — a different act entirely, and one nobody asked for.
                  Not offered on a shared screen, where you hold every chair and there is nowhere to
                  move TO. */}
              {seat.kind !== 'human' &&
                !sharedScreen &&
                inLobby &&
                mySeatIndex !== -1 &&
                mySeatIndex !== i && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      sit(i);
                    }}
                  >
                    Move here
                  </Button>
                )}
              {/*
                LEAVING, only where leaving STICKS. In the lobby a vacated chair is immediately the
                best chair for an arriving player to take — and you are one, so `useAutoSeat` would
                put you straight back in it and the button would read as broken. That is not a bug to
                work around: "give up my seat but stay on this page" stopped being a state the moment
                arriving became sitting down, and the way out of a table is `<ExitGame>` in the
                header, which is the ONE exit this OS offers by rule.

                Mid-game it is the real thing — drop-OUT, handing your hand to the house so the table
                does not stall — and `sharedScreen` keeps it because auto-seating never fires there
                (the host already holds a seat, so the predicate answers `-1`), leaving a hot-seat
                host free to give a local chair back.
              */}
              {isMine && (!inLobby || sharedScreen) && (
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => {
                    void release(i, inLobby ? 'open' : 'ai');
                  }}
                >
                  Leave
                </Button>
              )}
              {allowAi && isHost && inLobby && seat.kind === 'open' && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void setAi(i, aiSeatName(i));
                  }}
                >
                  Add CPU
                </Button>
              )}
              {allowAi && isHost && inLobby && seat.kind === 'ai' && (
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => {
                    void setAi(i, null);
                  }}
                >
                  Remove
                </Button>
              )}
            </span>
          </div>
        );
      })}
      {/*
        Drawn only when it has something to do — the same gate the per-seat controls carry, plus an
        open chair to fill. A "Fill with CPUs" on a table with no empty chair is a control that
        cannot change the outcome, which this repo hides rather than disables (the seat picker and
        the visibility toggle are hidden on exactly that argument).
      */}
      {allowAi && isHost && inLobby && openChairs > 0 && (
        <Button size="sm" variant="ghost" className="mt-2 self-start" onClick={fillWithCpus}>
          Fill with CPUs
        </Button>
      )}
    </Card>
  );
}
