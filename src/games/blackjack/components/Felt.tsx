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
 * **THE SHOE IS FULL AND IT DOES NOT DRAIN, because that is the truth.** `openRound` shuffles a
 * fresh deck every round — there is no persistent shoe here, deliberately, and
 * `plans/BLACKJACK_DEPTH.md` §1.1 is explicit that this is load-bearing rather than a
 * simplification: a shoe that survives a hand is a shoe that can be COUNTED, and a counted shoe is
 * the one way a player takes a real edge off a house paying out of a real ledger. So the corner
 * draws a full deck sitting in its shoe and never animates it down. A shoe that visibly depleted
 * and then silently refilled would be a lie painted on the felt, which is a worse thing to ship
 * than no shoe at all.
 *
 * **THE TABLE HAS FOUR BANDS AND THE SPACE BETWEEN THEM IS THE DESIGN.** It shipped as a single
 * `gap-4` column, which on a 1024px felt drew a ~250px ribbon of content down the middle of a
 * mostly-empty green rectangle: the dealer's cards, the print and the player's chair all within a
 * few pixels of each other, and a lake of unused cloth underneath. Every element was correctly
 * placed relative to its neighbour and the table read as a pile. The fix is `my-auto` on the print,
 * which is the one line here worth understanding — an auto margin in a flex column absorbs the free
 * space on BOTH sides, so the dealer is pinned to the top edge, the chairs and the apron to the
 * bottom, and the print floats at the waist wherever the table happens to be tall. That is the
 * layout doing the spacing rather than a stack of hand-tuned gaps that go wrong at the next height.
 *
 * **THE APRON IS THE RAIL, AND THE CONTROLS BELONG ON IT.** The chip rack and the hit/stand row
 * used to be `<Card>` panels floating below the felt, which is the same defect as the chairs being
 * a wrapped flex: they are part of the table in every casino on earth and they were drawn as a
 * form. It fits inside the bottom curve with room to spare — at `rounded-b-[34%]` on a 1024px-wide
 * table the cloth is still ~700px across 30px off the bottom edge — and it is a MIN-HEIGHT slot,
 * sized so the tallest thing it holds (the chip tray) and the shortest (a hit/stand row) leave the
 * table roughly the same height. Not exactly, and the trade is deliberate: a slot padded to the
 * tray's full height would put ~70px of dead cloth under the cards for the whole of every hand,
 * which is a permanent cost paid to avoid a one-off settle at the deal.
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

/**
 * HOW THE CHAIRS SHARE THE CLOTH — spread across a bounded row, with a gap ladder as the FLOOR.
 *
 * UNO's war story is that `w-full justify-between` is not a distance at all: it hands the spacing to
 * whatever width the element happens to have, so a table reads as a huddle on a laptop and as three
 * unrelated groups on a desktop. That argument is about a row bounded by the VIEWPORT. This row is
 * bounded by the felt, which is `max-w-5xl` and centred — a distance the TABLE chose — so
 * distributing inside it is the same kind of answer as UNO's rungs rather than the failure they
 * replaced.
 *
 * It needs to distribute because the two ends of the range want opposite things and a single gap
 * cannot serve both: two chairs at a 96px gap sat in a 285px clot in the middle of 1024px of cloth
 * (measured), and four chairs at the gap two chairs want would run off the felt. `justify-around`
 * gives the small table the room and packs the big one down to the ladder, which is the floor that
 * stops four chairs ever touching.
 */
const SEAT_ROW = 'w-full max-w-3xl justify-around';
const SEAT_GAP = 'gap-x-6 gap-y-8 sm:gap-x-10 lg:gap-x-12';

export function Felt({
  felt,
  dealer,
  apron,
  children,
  className,
}: {
  /** The player's equipped felt image, or null. Drawn OVER the cloth, so buying one still changes
   *  the table and owning none gets blackjack's own green rather than a bare panel. */
  readonly felt: string | null;
  /** The dealer's own hand and total — one hand for the whole table. */
  readonly dealer: ReactNode;
  /**
   * What sits on the rail: the chip rack while the table is taking bets, the hit/stand row on your
   * turn, the insurance offer when it is made. Optional, and an absent one still reserves most of
   * its height — see the min-height below.
   */
  readonly apron?: ReactNode;
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

        <div className="flex min-h-[26rem] flex-col items-center px-3 pt-6 pb-5 sm:min-h-[30rem] sm:px-8 sm:pt-7">
          {/* THE DEALER, once, at the top — every chair plays the same dealer rather than its own. */}
          <div className="flex flex-col items-center gap-2">{dealer}</div>

          {/* THE PRINT, at the waist. Derived from the rulebook (see tablePrint.ts), never typed
              out, because it is a promise about money and a stale one is a table that lies about
              its own odds. Low-contrast on purpose: it is painted ON the cloth, not printed on top
              of it, and it must never compete with a card.

              `my-auto` is what spaces the whole table — see the header. */}
          <div
            aria-hidden
            className="font-display text-accent/35 my-auto flex flex-col items-center gap-1 py-4 text-center leading-tight tracking-[0.18em]"
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
          <div className={cx('flex flex-wrap items-start', SEAT_ROW, SEAT_GAP)}>{children}</div>

          {/* THE RAIL. A reserved slot rather than a conditional element: the table must not change
              height when the round moves from betting to playing, because a felt that grows and
              shrinks under a player's cards is the whole board jumping on every hand. */}
          <div className="mt-5 flex min-h-[6.5rem] w-full max-w-2xl items-start justify-center">
            {apron}
          </div>
        </div>
      </div>
    </div>
  );
}
