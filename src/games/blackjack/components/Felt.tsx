import type { ReactNode } from 'react';
import { cx } from '@/ui';
import { cardBackSrc } from '@/system/cards/cards';
import { useEquippedCardBack } from '@/system/cards/useCardBack';
import { tablePrint } from '@/games/blackjack/tablePrint';

/**
 * THE TABLE ITSELF — the half-moon, the cloth, the terms painted on it, and the shoe in the corner.
 *
 * This is the piece Boardwalk's blackjack never had. The board was a `<Card felt>` holding two
 * stacked rows of cards and a wrapping flex of chairs, which is a correct rendering of the game
 * state and says nothing about what game it is. A blackjack table is one of the most recognisable
 * objects in a casino, and essentially all of that recognition is in four things: the green cloth,
 * the dark rail curving round it, the print, and the shoe.
 *
 * **IT IS AN OBJECT, SO IT HAS A WIDTH OF ITS OWN.** The first build let the felt fill whatever it
 * was given, which on a desktop put a 1520px hairline across the screen with 250px of cards in the
 * middle of it — three unrelated groups rather than one table. UNO's board learned the same lesson
 * from a screenshot ("the seats ring the piles at a distance the TABLE chooses, not at the width of
 * whatever screen it is drawn on"), and the answer is the same: bound it, centre it, and let the
 * arc be a real edge rather than a wire.
 *
 * **THE SHOE IS FULL AND IT DOES NOT DRAIN, because that is the truth.** `dealHand` shuffles a
 * fresh 52 on every single deal — there is no persistent shoe here, deliberately, and
 * `plans/BLACKJACK_DEPTH.md` §1.1 is explicit that this is load-bearing rather than a
 * simplification: a shoe that survives a hand is a shoe that can be COUNTED, and a counted shoe is
 * the one way a player takes a real edge off a house paying out of a real ledger. So the corner
 * draws a full deck sitting in its shoe and never animates it down. A shoe that visibly depleted
 * and then silently refilled would be a lie painted on the felt, which is a worse thing to ship
 * than no shoe at all.
 */

/** How many card backs make the visible stack in the shoe. Enough to read as a deck, not a tower. */
const SHOE_DEPTH = 5;

function Shoe() {
  const back = useEquippedCardBack();
  return (
    <div className="pointer-events-none absolute top-4 right-5 hidden sm:block" aria-hidden>
      <div className="relative h-[4.4rem] w-[3.2rem]">
        {Array.from({ length: SHOE_DEPTH }, (_, i) => (
          <img
            key={i}
            src={cardBackSrc(back)}
            alt=""
            width={140}
            height={190}
            className="border-bw-line/60 absolute inset-0 h-full w-full rounded-md border object-cover shadow-md"
            // Each card behind the last, up and to the right — a deck seen at a slight angle.
            style={{
              transform: `translate(${String(i * 1.5)}px, ${String(-i * 1.5)}px)`,
              zIndex: i,
            }}
          />
        ))}
      </div>
      <span className="font-display text-bw-muted mt-2 block text-center text-[0.55rem] tracking-[0.2em] uppercase">
        Shoe
      </span>
    </div>
  );
}

export function Felt({
  felt,
  dealer,
  children,
  className,
}: {
  /** The player's equipped felt image, or null. Drawn OVER the cloth, so buying one still changes
   *  the table and owning none gets blackjack's own green rather than a bare panel. */
  readonly felt: string | null;
  /** The dealer's own hand and total — one hand for the whole table. */
  readonly dealer: ReactNode;
  /** The chairs, already placed on the arc by the caller. */
  readonly children: ReactNode;
  /** Layout only. */
  readonly className?: string;
}) {
  return (
    <div className={cx('mx-auto w-full max-w-5xl', className)}>
      <div
        className={cx(
          // THE TABLE. `isolate` is load-bearing for the same reason it is in `<Card>`: the felt
          // image sits at `-z-10` to land behind the content, and without a stacking context that
          // would escape and slide behind the PAGE.
          'border-bj-rail bg-bj-felt shadow-lift relative isolate overflow-hidden',
          // The half-moon: square across the dealer's straight edge, curved round the players.
          // The depth is a decision in both directions — a shallower curve stops reading as a
          // half-moon at all, and a deeper one leaves a lake of empty cloth under the last chair,
          // which is what the first build shipped.
          'rounded-t-xl rounded-b-[34%]',
          'border-[7px]'
        )}
      >
        {felt !== null && (
          <img
            src={felt}
            alt=""
            className="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover opacity-80"
          />
        )}
        {/* The cloth darkening toward the rail, so the table reads as lit from above rather than
            as a flat green rectangle. Tokens only — the theme is the one file that names a colour. */}
        <div
          aria-hidden
          className="from-bj-rail/50 pointer-events-none absolute inset-0 -z-10 bg-linear-to-t to-transparent to-45%"
        />

        <Shoe />

        <div className="flex flex-col items-center gap-4 px-3 pt-6 pb-10 sm:px-8 sm:pb-14">
          {/* THE DEALER, once, at the top — every chair plays the same dealer rather than its own. */}
          <div className="flex flex-col items-center gap-1.5">{dealer}</div>

          {/* THE PRINT. Derived from the rulebook (see tablePrint.ts), never typed out, because it
              is a promise about money and a stale one is a table that lies about its own odds.
              Low-contrast on purpose: it is painted ON the cloth, not printed on top of it, and it
              must never compete with a card. */}
          <div
            aria-hidden
            className="font-display text-accent/35 flex flex-col items-center gap-0.5 text-center leading-tight tracking-[0.18em]"
          >
            {tablePrint().map((line, i) => (
              <span
                key={line}
                className={i === 0 ? 'text-sm sm:text-base' : 'text-[0.6rem] sm:text-xs'}
              >
                {line}
              </span>
            ))}
          </div>

          {/* THE CHAIRS, on the arc. `seatArc` has already told each one how far down to sit, so the
              row curves with the rail rather than running straight across it. */}
          <div className="flex w-full flex-wrap items-start justify-center gap-x-4 gap-y-6 pt-2 sm:gap-x-10">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
