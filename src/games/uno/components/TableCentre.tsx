import { cx } from '@/ui';
import { unoBackSrc, unoCardSrc } from '@/games/uno/art';
import type { Card, UnoColor } from '@boardwalk/game-logic/games/uno';

/**
 * THE MIDDLE OF THE TABLE — the draw pile, the discard, which colour is live, and which way play is
 * going. v1 put all four in the centre and it is right: these are the only facts every player needs
 * at once, and a hidden-hand game has nowhere else to put them.
 *
 * THE DIRECTION RING IS FOUR ARROWS AND NOTHING ELSE — no track is drawn under them. A faint
 * circle was tried, and it does make the concentricity self-evident; it also adds a second static
 * ring to a felt that already carries a lit draw pile, a lit playable card and a glowing discard,
 * which is one ring too many. The arrows are the reading; they just have to be big enough to be
 * one.
 *
 * THE DIRECTION RING is the piece that looks decorative and is not. Reverse is the one action card
 * whose effect is invisible — a skip removes a turn you can see coming, a draw-two lands on somebody,
 * but a reverse changes nothing on the felt and everything about who plays next. v1 answered with
 * four arrows slowly orbiting the piles, and the reason it works is that the ROTATION carries the
 * state: you read it out of the corner of your eye without looking at it. It is `animate-spin`
 * slowed right down and run backwards for anticlockwise, so it costs no new theme token, and
 * `prefers-reduced-motion` stops it with everything else.
 *
 * THE ARROWHEADS ARE TANGENTIAL, and this is the part the first pass got wrong. It placed `↑ → ↓ ←`
 * at top/right/bottom/left — each arrow pointing straight OUT from the centre, which is not a
 * rotation at all, it is an explosion. Spinning it did not rescue the reading: a player sees four
 * arrows aimed at the four walls of the room and the spin looks like decoration wrapped around the
 * piles. An arrow that says "play goes this way" has to point ALONG the circle, not away from it —
 * clockwise is `→` at the top, `↓` on the right, `←` at the bottom, `↑` on the left, which is v1's
 * own set, and it is legible in a still screenshot before the animation contributes anything.
 * So both halves now carry the state: the arrowheads say which way, the spin repeats it in motion.
 *
 * ═══ TWO THINGS WERE WRONG WITH IT ON SCREEN, AND ONLY ONE WAS VISIBLE IN THE CODE ═══
 *
 * 1. THE RING WANDERED OFF THE PILES AS IT TURNED, which is what "the spinny thing and the deck
 *    aren't centred on each other" turned out to be. The centring (`-translate-x-1/2
 *    -translate-y-1/2`) and the rotation were on the SAME element, and `animate-spin`'s keyframe
 *    sets the whole `transform` property — so the animation's implicit `from` is the element's
 *    translated transform, its `to` is a bare `rotate(360deg)` with no translation in it, and the
 *    browser interpolates the two by decomposing matrices. The ring therefore slides off centre
 *    over the cycle and snaps back at the seam. It is CORRECT at t=0, which is why it survives
 *    every static reading and every screenshot taken at the wrong moment.
 *
 *    `SeatView` documents the identical trap one file over ("on one element `animate-deal`'s
 *    keyframed `transform` would replace the rotation"), and the fix is the same: two elements. The
 *    outer one is placed and centred and never animated; the inner one only ever spins.
 *
 * 2. THE ARROWS CUT THROUGH THE CORNERS OF THE CARDS. Their radius was ~6.25rem while the piles box
 *    measures 10.5 × 7rem, whose own circumscribed radius is 6.31rem — so the orbit passed INSIDE
 *    the corners of the thing it is supposed to be orbiting, and the top and bottom arrows had
 *    3.5rem of daylight while the side ones grazed the discard. That reads as "off centre" even in
 *    a still. The ring is sized off that measurement now, and the four glyphs are placed by their
 *    own CENTRES (`-translate-x-1/2 -translate-y-1/2` on each, in both axes) rather than by
 *    whichever edge happened to be convenient — so all four sit exactly on one circle instead of
 *    approximately on one.
 *
 * THE ACTIVE COLOUR IS SAID EXACTLY WHERE THE CARD CANNOT SAY IT ITSELF, which is the whole rule
 * and it took two passes to land on.
 *
 * The pill used to be unconditional: it said "RED" under a red card beside a red-tinted border,
 * three statements of one fact stacked in the middle of the table, so it went. The halo replaced
 * it — the discard lit from `color` rather than from the card — and that is right for a coloured
 * top card and NOT ENOUGH for the one case the pill was actually earning its place in: a wild or a
 * +4, which is black, whose face carries no colour at all, and which is precisely the moment the
 * colour CHANGED. A soft glow is a fine reminder of something you already know and a poor
 * announcement of something that just happened; the report was exactly that.
 *
 * So the pill is back, and its condition is a property of the CARD rather than a timer: it is drawn
 * when `top` is colourless, and only then. That is the two complaints reconciled rather than
 * traded off — no redundancy over a red 8, a named colour over a wild — and it is derived, so it
 * cannot drift out of step with what the discard is showing. A timer ("show it for 3s after a
 * change") would put the answer on screen only for whoever was looking, and the player who glances
 * up late is the one who needs it.
 *
 * The halo stays under both. On a wild it is now the pill's echo rather than the only signal, and
 * on a coloured card it is the felt lit by the card, which is what a table looks like. The
 * screen-reader line stays too, because a blur is not text and neither is a coloured pill.
 */

/** The colour the felt is lit in — the active colour, which is NOT always the top card's. */
/**
 * The pill's surface, TINTED rather than solid. Solid was the obvious port from v1 and fails on
 * contrast: `--color-uno-yellow` is a light token and `--color-uno-red` a mid one, so one label
 * would need dark text and the other light, and a per-colour text rule is two more tokens for a
 * thing that is already unambiguous. Tint the surface, keep the border and the dot at full
 * strength, and the text stays `base-content` against a background the theme has already checked.
 */
const TINT: Record<UnoColor, string> = {
  red: 'bg-uno-red/20 border-uno-red text-base-content',
  blue: 'bg-uno-blue/20 border-uno-blue text-base-content',
  green: 'bg-uno-green/20 border-uno-green text-base-content',
  yellow: 'bg-uno-yellow/20 border-uno-yellow text-base-content',
};

/** The dot inside the pill, at full strength — the one place the raw colour is stated. */
const SWATCH: Record<UnoColor, string> = {
  red: 'bg-uno-red',
  blue: 'bg-uno-blue',
  green: 'bg-uno-green',
  yellow: 'bg-uno-yellow',
};

const HALO: Record<UnoColor, string> = {
  red: 'bg-uno-red/50',
  blue: 'bg-uno-blue/50',
  green: 'bg-uno-green/50',
  yellow: 'bg-uno-yellow/50',
};

/**
 * Where each arrow sits on the ring — by its own CENTRE, so the four are genuinely concentric.
 * `left-full`/`top-full` put the anchor on the far edge; the pair of `-translate-*-1/2` then pulls
 * the glyph back onto it. See note 2 above for why "the edge that was convenient" is not good
 * enough here.
 */
const AT = [
  'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2',
  'top-1/2 left-full -translate-x-1/2 -translate-y-1/2',
  'top-full left-1/2 -translate-x-1/2 -translate-y-1/2',
  'top-1/2 left-0 -translate-x-1/2 -translate-y-1/2',
] as const;

/** Tangential, in the same order as `AT`: top, right, bottom, left. Clockwise, then anticlockwise. */
const GLYPHS: Record<1 | -1, readonly [string, string, string, string]> = {
  1: ['→', '↓', '←', '↑'],
  [-1]: ['←', '↑', '→', '↓'],
};

export interface TableCentreProps {
  readonly top: Card;
  readonly color: UnoColor;
  readonly direction: 1 | -1;
  readonly deckCount: number;
  /** Cards a live stack owes whoever is on turn; `0` at a table not playing that house rule. */
  readonly pending: number;
  readonly canDraw: boolean;
  readonly onDraw: () => void;
}

export function TableCentre({
  top,
  color,
  direction,
  deckCount,
  pending,
  canDraw,
  onDraw,
}: TableCentreProps) {
  // A CARD THAT CANNOT SAY ITS OWN COLOUR. Asked of the KIND rather than of `card.color === 'wild'`
  // so it stays true if the deck ever gains another colourless card, and asked of the card rather
  // than of a "did the colour just change" flag, which would be a second source of truth for
  // something the discard already knows.
  const colourless = top.kind === 'wild' || top.kind === 'wild4';
  return (
    // THE COLUMN RESERVES THE RING'S OWN OVERHANG (`px-10 py-18` ≈ the 2.25rem / 4rem the 15rem
    // ring reaches past a 10.5 × 7rem pile box, plus a little for the glyphs' ink). That is what
    // makes the table's spacing composable: every gap in `Board.tsx` is then measured from the
    // outside of the ring rather than from the cards, so no arrangement of seats can be pushed into
    // it — including the heads-up table, which has no flank seats to hold the far player off and is
    // exactly where the top arrow used to land in somebody's hand.
    <div className="relative flex items-center justify-center px-10 py-18">
      {/* PLACED AND CENTRED — never animated. See note 1: a rotation keyframe on this element would
          replace the centring transform and walk the ring off the piles as it turns. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 size-60 -translate-x-1/2 -translate-y-1/2"
      >
        {/* NO CIRCLE IS DRAWN, and that was tried. Sizing the ring to clear the cards left the four
            arrows reading as specks, so a faint circle was added under them — which does make the
            concentricity visible and also puts a second static ring on a felt that already has a
            lit pile, a lit playable card and a glowing discard. The arrows alone are the v1 reading
            and the one that was asked for; what they needed was not a track to sit on but simply to
            be legible, so they are `text-3xl` in a text token rather than `text-2xl` in a border
            one. The geometry stays exactly as measured — four glyphs, one radius, centred on the
            piles — it is just no longer drawn. */}
        {/* SPUN — and it carries no placement of its own, so there is nothing for the keyframe to
            overwrite. */}
        <div
          className={cx(
            'text-bw-muted relative size-full animate-spin [animation-duration:14s]',
            direction === -1 && '[animation-direction:reverse]'
          )}
        >
          {AT.map((at, i) => (
            <span
              key={at}
              // No background: the chip behind each glyph existed only to break the drawn circle's
              // stroke, and a filled rectangle floating on bare felt is worse than the problem.
              className={cx('absolute text-3xl leading-none', at)}
            >
              {GLYPHS[direction][i]}
            </span>
          ))}
        </div>
      </div>

      <div className="relative flex items-center gap-6">
        {/* DRAW PILE — a real stack, because "how much deck is left" is a thing players watch. */}
        <button
          type="button"
          disabled={!canDraw}
          onClick={onDraw}
          aria-label={
            pending > 0
              ? `Take the stack — ${String(pending)} cards`
              : `Draw a card — ${String(deckCount)} left in the deck`
          }
          className={cx(
            'group rounded-box relative transition',
            canDraw
              ? 'focus-visible:outline-secondary cursor-pointer hover:-translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-4'
              : 'cursor-default brightness-75'
          )}
        >
          {/* The two cards UNDER the top one. They are darkened, not faded: a translucent card
              shows the felt through the sliver of it that sticks out, which reads as a smudge
              rather than a deck. Brightness keeps them opaque, so the stack reads as depth. */}
          <img
            src={unoBackSrc()}
            alt=""
            aria-hidden
            className="absolute top-1 left-1 h-28 w-auto rounded-md brightness-50"
          />
          <img
            src={unoBackSrc()}
            alt=""
            aria-hidden
            className="absolute top-0.5 left-0.5 h-28 w-auto rounded-md brightness-75"
          />
          <img
            src={unoBackSrc()}
            alt=""
            aria-hidden
            className={cx(
              'relative h-28 w-auto rounded-md transition',
              canDraw && 'group-hover:shadow-glow-primary'
            )}
          />
          <span className="bg-base-100/90 border-bw-line text-bw-muted absolute -right-2 -bottom-2 rounded-full border px-1.5 py-0.5 text-[0.65rem] tabular-nums">
            {deckCount}
          </span>
          {/* WHAT THE PILE OWES YOU. The deck-count badge's own treatment mirrored to the opposite
              corner, because it is the same kind of fact about the same object — how many cards are
              coming off it. FLAT `warning` and no glow: the budget is blue=act, cyan=here,
              gold=money, and a stack is a threat rather than any of the three. It is also the one
              number on the felt that makes the dimmed fan legible — without it, a hand where only
              the +2s light up reads as a bug. */}
          {pending > 0 && (
            <span className="bg-base-100/90 border-warning text-warning absolute -top-2 -left-2 rounded-full border px-1.5 py-0.5 text-[0.7rem] font-bold tabular-nums">
              +{pending}
            </span>
          )}
        </button>

        {/* DISCARD — keyed on the card's id so a new top card MOUNTS and plays `pitch` once, sitting
            in the light of whatever colour is live. */}
        <div className="relative">
          <span
            aria-hidden
            className={cx('absolute -inset-2 rounded-2xl blur-lg transition-colors', HALO[color])}
          />
          <img
            key={top.id}
            src={unoCardSrc(top)}
            alt="Top of the pile"
            className="animate-pitch relative h-28 w-auto rounded-md"
          />
        </div>

        {/* WHAT COLOUR A WILD WAS CALLED AS — UNDER THE PILES, not clipped onto the discard.
            It first sat `-bottom-3.5` inside the discard's own box, straddling the card's bottom
            edge, and that is the one placement it must not have: a rounded pill cutting across the
            corner radius of the card it labels reads as a badge that has come loose, and it lands
            on the art rather than on the felt. It is also the only element on this table that
            covers a card.

            THE ANCHOR IS THE ROW, NOT THE COLUMN AND NOT THE CARD. `top-full` on the pile row is
            the cards' own bottom edge, so the pill still travels with the piles — the property the
            old placement was reaching for — while `left-1/2` centres it on the PAIR rather than on
            the discard, which is what the fact is about: the colour is the table's, not that one
            card's, and the halo is already the discard's own copy of it.

            `mt-4` IS MEASURED RATHER THAN CHOSEN. The band below the cards is ~49px of clear air:
            the draw pile's deck-count badge hangs 8px past the card bottom, and the ring's bottom
            arrow starts its em-box 105px below the piles' centre (the cards end 56px below it).
            16px down puts the pill's 26px in the middle of that — 8px clear of the badge above and
            ~7px clear of the arrow below — so it lands on bare felt with nothing to fight. See the
            header for why it is drawn at all, and only here. */}
        {colourless && (
          <span
            className={cx(
              'font-display absolute top-full left-1/2 z-10 mt-4 -translate-x-1/2 whitespace-nowrap',
              'rounded-full border px-3 py-1 text-xs font-semibold tracking-[0.14em] uppercase',
              TINT[color]
            )}
          >
            <span
              aria-hidden
              className={cx('mr-1.5 inline-block size-2 rounded-full', SWATCH[color])}
            />
            {color}
          </span>
        )}
      </div>

      {/* The halo is light, not text. A wild's chosen colour is information a reader would otherwise
          have no way at all to get, since the card's own face does not carry it. */}
      <span className="sr-only" aria-live="polite">{`Colour in play: ${color}`}</span>
    </div>
  );
}
