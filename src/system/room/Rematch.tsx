import { useEffect, useRef } from 'react';
import { Button } from '@/ui';
import { castVotes, haveVoted, rematchTally, type Rematchable } from '@/system/room/rematch';
import { useRoom } from '@/system/room/useRoom';
import { useSeats } from '@/system/room/useSeats';

/**
 * `<Rematch>` — the OS's play-again control, and the whole game-facing surface of the service. A
 * game renders it when its own state says the game is over and passes ONE thing: how to start the
 * next round. Everything else — who has to agree, who is asked, when the restart fires, what the
 * button says — is the OS's, once, instead of each game's, differently.
 *
 * WHY A COMPONENT AND NOT A HOOK. Both existed in the draft and only one had a caller: every game
 * that wants a rematch wants the same button under the same result line. Exporting a `useRematch`
 * beside it would be a seam with nothing on the other end — `loadout.color` in hook form. The pure
 * tally is exported (`@/system/room/rematch`) because that is what the tests drive; a game wanting
 * its own control can read the tally and is one export away, in the commit that has that game.
 *
 * `restart(round)` is called ON THE HOST ONLY, exactly once per agreed handshake. Host-only is not
 * a privilege here, it is de-duplication: every client sees the same agreed tally at the same seq,
 * and all of them writing the next round would be a race the seq counter would happily serialise
 * into several deals. Tic-Tac-Toe and Chess pass `patch(() => initialState(round))`; UNO passes its
 * dealer's `dealAgain`, which is already host-only for the same reason.
 *
 * Restarting CLEARS the votes for free and this is by construction rather than by a cleanup step:
 * the next round is a fresh state object from the game's own `initialState`/`toPublic`, which has
 * never heard of `rematch`. There is no vote-clearing code path to forget to call.
 */
export interface RematchProps {
  /**
   * Start the next round. Called with the round number to deal (the current round + 1), on the host
   * only, once per handshake. A non-host's copy is never invoked, so a host-only action (UNO's
   * `dealAgain`) can be passed directly.
   */
  readonly restart: (round: number) => void;
  /** The button's label. Defaults to "Play again"; UNO says "Deal again". */
  readonly label?: string;
}

export function Rematch({ restart, label = 'Play again' }: RematchProps) {
  const { state, seats, patch, isHost } = useRoom<Rematchable>();
  const { localSeatIds } = useSeats();

  const votes = state?.rematch;
  const round = state?.round ?? 0;
  const tally = rematchTally(votes, seats);
  const mine = haveVoted(votes, localSeatIds);

  // Fire the restart once per agreed handshake. The ref keys on `round` so the effect cannot deal
  // twice inside the window between the write and the snapshot that clears the votes — the same
  // once-per-round guard every board already uses to report a result exactly once.
  const restartedRound = useRef<number | null>(null);
  useEffect(() => {
    if (!isHost || !tally.agreed) return;
    if (restartedRound.current === round) return;
    restartedRound.current = round;
    restart(round + 1);
  }, [isHost, tally.agreed, round, restart]);

  // A spectator (no seat) is not asked and gets no button — there is nothing for it to agree to.
  if (localSeatIds.length === 0) return null;

  const waiting = tally.needed.length - tally.voted.length;

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        variant={mine ? 'ghost' : 'primary'}
        disabled={mine}
        onClick={() => {
          void patch((prev) =>
            prev === null
              ? { round: 0, rematch: castVotes(undefined, localSeatIds) }
              : { ...prev, rematch: castVotes(prev.rematch, localSeatIds) }
          );
        }}
      >
        {mine ? 'Ready ✓' : label}
      </Button>
      {/* Only worth saying when someone else's answer is outstanding — a solo-vs-bots table
          restarts on the click and never renders this. */}
      {mine && waiting > 0 && (
        <p className="text-bw-muted text-xs">
          Waiting for {waiting} player{waiting === 1 ? '' : 's'} ({tally.voted.length}/
          {tally.needed.length} ready)
        </p>
      )}
    </div>
  );
}
