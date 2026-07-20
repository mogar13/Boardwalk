import { useEffect, useRef, useState } from 'react';
import { Card, cx, useToast } from '@/ui';
import { useGame } from '@/system/economy/useGame';
import { useEquippedFelt } from '@/system/felt/useEquippedFelt';
import { useEquippedDice } from '@/system/dice/useEquippedDice';
import { useAudio } from '@/system/audio/useAudio';
import { useRoom } from '@/system/room/useRoom';
import { useSeats } from '@/system/room/useSeats';
import { useHand } from '@/system/room/useHand';
import { mintNonce, useAuthStore } from '@/system/auth/authStore';
import { repos } from '@/system/repo';
import { formatMoney } from '@boardwalk/game-logic';
import {
  isLegalRaise,
  type Face,
  type LiarsDiceHand,
  type LiarsDicePublic,
} from '@boardwalk/game-logic/games/liars-dice';
import { Die, HiddenDie } from '@/games/liars-dice/components/Die';
import { BidControls } from '@/games/liars-dice/components/BidControls';

/**
 * The board — a pure renderer plus an action sender, and the thinnest of the six.
 *
 * IT RUNS NO RULES AND HOLDS NO GAME. Every other multiplayer board in this repo either applies a
 * reducer (Tic-Tac-Toe, Chess) or hosts one (UNO's `useUnoHost`). This one does neither: the
 * referee holds the match, so an action is a message and the resulting table arrives back over the
 * ordinary room subscription. That is why there is no `useLiarsDiceHost.ts` beside this file, and
 * why the host's own actions take exactly the same road as everyone else's — there is no "host
 * applies it locally" path to diverge.
 *
 * It DOES run `isLegalRaise`, and that is not a contradiction. The check here is for FEEL — grey
 * out a bid the ladder will refuse, so the player is not typing into a wall — and the referee
 * checks it again and decides. Same split as `validateBet` on the chip rack: the client's copy is
 * feedback, the server's copy is the answer, and they are literally the same function.
 */
export function Board() {
  const { state, seats, status, gameId, roomId, isHost, myId } = useRoom<LiarsDicePublic>();
  const { mySeatIndex } = useSeats();
  const { manifest } = useGame();
  const adoptProfile = useAuthStore((s) => s.adoptProfile);
  const felt = useEquippedFelt();
  const diceId = useEquippedDice();
  const audio = useAudio();
  const toast = useToast();

  const myHand = useHand<LiarsDiceHand>(mySeatIndex);
  const myDice = myHand?.dice ?? [];

  const [busy, setBusy] = useState(false);
  const dealtRef = useRef(false);
  /** Which money-moving moment this client has already synced its profile for. */
  const syncedMoment = useRef<string>('');
  const heardResolution = useRef<number | null>(null);

  const humans = seats.filter((s) => s.kind === 'human').length;
  const betting = manifest.betting !== undefined && humans >= 2;
  const ante = betting ? manifest.betting.min : 0;

  /**
   * The host asks the referee to deal, ONCE. `state === null` is the not-yet-dealt signal, the
   * same one UNO uses; the nonce makes a double-fire a replay rather than a second match, so the
   * ref is belt to the server's braces rather than the only thing standing between a player and
   * two antes.
   */
  useEffect(() => {
    if (!isHost || status !== 'playing' || state !== null || dealtRef.current) return;
    if (repos.liarsDice === null) return;
    dealtRef.current = true;
    void repos.liarsDice
      .start(gameId, roomId, { nonce: mintNonce(), anteCents: ante })
      .then((res) => {
        if (res.ok) adoptProfile(res.value);
        else toast.error(res.error);
      });
  }, [isHost, status, state, gameId, roomId, ante, toast, adoptProfile]);

  // The reveal has a sound, and it fires once per resolution rather than on every re-render.
  useEffect(() => {
    if (state?.resolution == null || state.phase !== 'reveal') return;
    if (heardResolution.current === state.round) return;
    heardResolution.current = state.round;
    audio.play(state.resolution.callerWon ? 'win' : 'lose');
  }, [state, audio]);

  /**
   * THE PROFILE SYNC. THIS GAME DOES NOT CALL `reportResult`, and that is the point of a dealt game.
   *
   * Every other board reports its own outcome and the server prices it. Here the referee already
   * ran `recordOutcome` inside the settle transaction — the stat, the XP and the achievements are
   * banked before any client knows the match ended — so reporting again would be a client claiming
   * a result the server has already recorded. `checkSettle` refuses `liars-dice` outright, so it
   * would not double-count; it would simply toast "settled by the dealer, not by a claim" at every
   * player at the end of every match. That is exactly what it did, and only the browser found it:
   * both halves are individually right and tested, and nothing wired them together.
   *
   * What IS needed is a profile refresh at the TWO moments the referee moves money, and it has to
   * be every seated player rather than whoever happened to act:
   *
   *   - THE DEAL takes every human's ante, but only the HOST sends `ldStart`. So the host learns its
   *     new balance from that reply and nobody else learns anything — in a real browser the host's
   *     top bar dropped a dollar and the other player's went on saying $5,000 while their ante sat
   *     in the ledger.
   *   - THE SETTLE pays the pot and records the outcome for everyone, and the action that triggers
   *     it can be a BOT's, in which case no client made a request at all.
   *
   * Keyed so each fires once: the deal per match, the settle per round.
   */
  useEffect(() => {
    if (state == null || mySeatIndex < 0) return;
    const moment = state.winner >= 0 ? `settled:${String(state.round)}` : 'dealt';
    if (syncedMoment.current === moment) return;
    syncedMoment.current = moment;
    void repos.profile.load(myId).then((p) => {
      if (p !== null) adoptProfile(p);
    });
  }, [state, mySeatIndex, myId, adoptProfile]);

  if (repos.liarsDice === null) {
    // Named rather than degraded. There is no RTDB version of "the server holds the dice", and a
    // local dealer would be one player's browser holding everyone's cups.
    return (
      <Card className="p-6 text-center">
        <p className="text-base-content/70">
          Liar&rsquo;s Dice needs the game server, and this build is running without it.
        </p>
      </Card>
    );
  }

  if (state === null) {
    return (
      <Card felt={felt} className="p-8 text-center">
        <p className="text-base-content/70">Shaking the cups&hellip;</p>
      </Card>
    );
  }

  const myTurn = state.turn === mySeatIndex && state.phase === 'bidding' && state.winner < 0;
  const open = state.phase === 'reveal' || state.phase === 'finished';

  async function send(action: Parameters<NonNullable<typeof repos.liarsDice>['act']>[2]['action']) {
    if (busy || repos.liarsDice === null) return;
    setBusy(true);
    audio.play('chip');
    const res = await repos.liarsDice.act(gameId, roomId, { nonce: mintNonce(), action });
    if (res.ok) adoptProfile(res.value);
    else toast.error(res.error);
    setBusy(false);
  }

  return (
    <Card felt={felt} className="flex flex-col gap-5 p-5">
      {/* ── the table ─────────────────────────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2">
        {seats.map((seat, index) => {
          const count = state.counts[index] ?? 0;
          const out = count === 0;
          const mine = index === mySeatIndex;
          // Your own dice come from your PRIVATE node; everyone else's exist only at the reveal.
          const faces: readonly Face[] = mine ? myDice : (state.revealed[index] ?? []);
          return (
            <div
              key={index}
              className={cx(
                'rounded-box border p-3 transition',
                out
                  ? 'border-base-content/10 opacity-40'
                  : state.turn === index
                    ? 'border-primary shadow-glow-primary'
                    : 'border-base-content/15'
              )}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold">
                  {seat.name === '' ? `Seat ${String(index + 1)}` : seat.name}
                  {mine && <span className="text-primary"> (you)</span>}
                </span>
                <span className="text-base-content/60 text-xs tabular-nums">
                  {out ? 'out' : `${String(count)} dice`}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: count }, (_, i) =>
                  faces[i] !== undefined ? (
                    <Die key={i} face={faces[i]} diceId={diceId} size={mine ? 'md' : 'sm'} />
                  ) : (
                    <HiddenDie key={i} size="sm" />
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── the standing bid, the reveal, the result ──────────────────────────────────────── */}
      <div className="border-base-content/15 flex flex-col items-center gap-2 rounded-box border p-4 text-center">
        {state.palificoSeat >= 0 && (
          <span className="text-warning text-xs font-bold tracking-widest uppercase">
            Palifico — ones are not wild
          </span>
        )}
        {state.bid === null ? (
          <p className="text-base-content/60 text-sm">No bid yet. Open the round.</p>
        ) : (
          <p className="font-display text-2xl">
            {state.bid.quantity} &times; {state.bid.face}
            {state.bid.face === 1 && state.palificoSeat < 0 && (
              <span className="text-base-content/60 text-sm"> (wild)</span>
            )}
          </p>
        )}

        {open && state.resolution !== null && (
          <p className="text-sm">
            <span className="font-semibold">
              {state.resolution.kind === 'spotOn' ? 'Spot on!' : 'Liar!'}
            </span>{' '}
            The table showed <span className="tabular-nums">{state.resolution.actual}</span>.{' '}
            {state.resolution.callerWon ? 'The call was good.' : 'The call was wrong.'}
          </p>
        )}

        {state.winner >= 0 && (
          <p className="text-primary font-display text-xl">
            {state.winner === mySeatIndex
              ? betting
                ? `You win ${formatMoney(ante * humans)}`
                : 'You win'
              : `${seats[state.winner]?.name ?? 'Seat'} wins`}
          </p>
        )}
      </div>

      {/* ── the controls ──────────────────────────────────────────────────────────────────── */}
      {myTurn ? (
        <BidControls
          // Remount on a new standing bid, so the staged quantity re-arms one rung above it.
          key={`${String(state.round)}:${String(state.bid?.quantity ?? 0)}:${String(state.bid?.face ?? 0)}`}
          state={state}
          busy={busy}
          canRaise={(bid) => isLegalRaise({ ...MATCH_SHIM, ...shimFor(state) }, bid)}
          onBid={(quantity, face) => void send({ type: 'bid', quantity, face })}
          onChallenge={() => void send({ type: 'challenge' })}
          onSpotOn={() => void send({ type: 'spotOn' })}
        />
      ) : (
        <p className="text-base-content/60 text-center text-sm">
          {state.winner >= 0
            ? 'Match over.'
            : state.phase === 'reveal'
              ? 'Counting the dice…'
              : `Waiting on ${seats[state.turn]?.name ?? 'the next player'}…`}
        </p>
      )}
    </Card>
  );
}

/**
 * `isLegalRaise` wants a match and the board only has a projection, so this rebuilds the parts it
 * reads: the ladder depends on the standing bid, the palifico flag and the TOTAL dice, all of which
 * are public by design (they have to be — a player cannot bid legally without them). The cups it
 * fills with blanks, because the ladder never looks at a face.
 *
 * The referee re-checks with the real match, so a wrong shim can only mis-grey a button, never
 * admit an illegal bid. It is here rather than in the rulebook because it is a UI convenience and
 * `logic/` should not grow a type that exists to make a renderer's life easier.
 */
const MATCH_SHIM = {
  turn: 0,
  phase: 'bidding' as const,
  resolution: null,
  winner: -1,
  round: 0,
  lockedFace: -1,
};

function shimFor(state: LiarsDicePublic) {
  return {
    dice: state.counts.map((n) => Array.from({ length: n }, (): Face => 2)),
    bid: state.bid,
    palificoSeat: state.palificoSeat,
    lockedFace: state.lockedFace,
  };
}
