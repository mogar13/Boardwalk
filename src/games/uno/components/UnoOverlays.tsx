import { useEffect, useState } from 'react';
import { cx } from '@/ui';
import { ordinal } from '@/games/uno/log';

/**
 * THE THINGS THE TABLE SHOUTS. v1 had four of them and every one is doing a job that the board
 * itself cannot, because they are all about a MOMENT rather than a state:
 *
 *   • YOUR TURN — the board already shows whose turn it is; what it cannot show is the instant it
 *     BECAME yours. Between a bot playing and you noticing, a state cue is silent. v1 parked this
 *     top-left "clear of the table and the card hands" after finding a centred one covered the
 *     piles, and that note is worth honouring rather than rediscovering.
 *   • UNO! — somebody is one card from winning. It is the single most important thing that happens
 *     in a round and it happens on somebody else's turn, off to the side of where you are looking.
 *   • FORGOT UNO — you just took two cards for a rule you did not break on purpose. Without this
 *     your hand silently grows and the log line scrolls past.
 *   • THE RESULT — who won, held until you dismiss it by asking for another deal.
 *
 * They are TRANSIENT and self-expiring except the result, which is a state. `useFlash` is the whole
 * mechanism: a trigger value that changes turns it on and a timer turns it off, so the board fires
 * one by changing a number rather than by orchestrating a timeout.
 */

/**
 * True for `ms` after `trigger` changes to a new non-null value. `null` never fires — which is what
 * makes "no event yet" and "an event whose value happens to repeat" different things: the board
 * passes a monotonic key, not a boolean, so two UNO calls in a row both flash.
 */
function useFlash(trigger: string | number | null, ms: number): boolean {
  const [shown, setShown] = useState<{ key: string | number | null; on: boolean }>({
    key: trigger,
    on: false,
  });

  if (shown.key !== trigger) setShown({ key: trigger, on: trigger !== null });

  const on = shown.on;
  const key = shown.key;
  useEffect(() => {
    if (!on) return;
    const timer = setTimeout(() => {
      setShown((s) => (s.key === key ? { key, on: false } : s));
    }, ms);
    return () => {
      clearTimeout(timer);
    };
  }, [on, key, ms]);

  return on;
}

/**
 * "★ YOUR TURN" — top-left of the table, which is v1's own placement after it found a centred one
 * covered the piles.
 *
 * IN FLOW, IN A ROW THAT IS ALWAYS THERE, rather than absolutely positioned over the felt. Floating
 * it was the obvious port and the first browser pass showed why it is wrong: at three seats the
 * left-hand player sits in exactly that corner, and the cue landed on top of them. A reserved row
 * costs about 40px of table and can never collide with a seat or shift the board when it appears.
 */
export function TurnCue({ turnKey }: { readonly turnKey: number | null }) {
  const show = useFlash(turnKey, 1800);
  return (
    <div className="flex h-10 w-full shrink-0 items-center">
      {show && (
        <div
          className="animate-cue border-secondary bg-base-300/95 text-secondary text-shadow-neon-cyan shadow-glow-secondary font-display rounded-box pointer-events-none border px-4 py-2 text-sm font-bold tracking-[0.15em] uppercase"
          role="status"
        >
          ★ Your turn
        </div>
      )}
    </div>
  );
}

/** "<NAME> YELLED UNO!" — centred over the table, briefly, because it is the loudest fact in UNO. */
export function UnoShout({ shout }: { readonly shout: { key: number; name: string } | null }) {
  const show = useFlash(shout === null ? null : shout.key, 1900);
  if (!show || shout === null) return null;
  return (
    <div
      className="animate-pitch border-warning bg-base-300/95 text-warning shadow-lift font-display pointer-events-none absolute top-1/2 left-1/2 z-30 -translate-x-1/2 -translate-y-1/2 rounded-box border-2 px-8 py-4 text-2xl font-black tracking-[0.2em] uppercase"
      role="status"
    >
      {shout.name} — UNO!
    </div>
  );
}

/** The +2 you just took for going to one card quietly. Only ever shown to the player it happened to. */
export function PenaltyFlash({ penaltyKey }: { readonly penaltyKey: number | null }) {
  const show = useFlash(penaltyKey, 2200);
  if (!show) return null;
  return (
    <div
      className="animate-pitch border-error bg-base-300/95 text-error shadow-glow-error font-display pointer-events-none absolute top-1/2 left-1/2 z-30 -translate-x-1/2 -translate-y-1/2 rounded-box border-2 px-6 py-3 text-center"
      role="status"
    >
      <p className="text-lg font-black tracking-[0.15em] uppercase">Forgot to call UNO</p>
      <p className="text-bw-muted text-xs tracking-widest uppercase">+2 penalty cards</p>
    </div>
  );
}

/** One line of the podium, already resolved to a name so this component never meets a seat roster. */
export interface PlaceRow {
  readonly seat: number;
  readonly name: string;
  readonly you: boolean;
}

/**
 * THE PODIUM — who finished where, and nothing else.
 *
 * It used to be a `RoundResult` panel that drew the verdict too, in a bordered box at the bottom of
 * the board with `<Rematch>` underneath it. Both of those are the OS's now (`<GameResult>`), and
 * the reason is the one that panel could not fix from inside a game: it was below the move log,
 * which is below the hand, which is below the felt — so the result of a round you had just played
 * was a scroll away. What is left here is the part that IS UNO's, because no other game has one.
 *
 * ONLY DRAWN WHEN THERE IS A PODIUM. Playing the ordinary game exactly one seat ever places, and a
 * standings list of one entry is a heading with nothing under it — so `places` comes back empty
 * there and the modal shows the verdict alone. It also renders nothing against a referee that has
 * not learned about places yet, which is what makes shipping this ahead of the Pi harmless.
 *
 * NO PER-PLACE PAYOUT, deliberately. The board could compute the split — `potSplit` is shared — but
 * it would have to guess which seats ANTED, and a seat that changed hands after the deal makes that
 * guess wrong. Quoting a player a figure the ledger did not pay them is worse than quoting none; the
 * pot total is on the felt and the bankroll in the top bar is the server's own number.
 */
export function Podium({ places }: { readonly places: readonly PlaceRow[] }) {
  if (places.length <= 1) return null;
  return (
    <ol className="flex flex-col gap-0.5 text-sm">
      {places.map((row, index) => (
        <li
          key={row.seat}
          className={cx(
            'flex items-center gap-2 tabular-nums',
            row.you ? 'text-secondary font-semibold' : 'text-base-content/70'
          )}
        >
          <span className="font-display w-8 text-right tracking-widest">{ordinal(index + 1)}</span>
          <span>{row.name}</span>
        </li>
      ))}
    </ol>
  );
}
