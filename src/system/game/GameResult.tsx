import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, Modal, cx } from '@/ui';

/**
 * `<GameResult>` — THE END OF A ROUND, DRAWN BY THE OS. Every game, current and future.
 *
 * WHAT WENT WRONG. Six games each grew their own end-of-round panel, and every one of them put it
 * in the same place: the BOTTOM of the board, under whatever the board already had. Under UNO's
 * move log. Under Liar's Dice's bid box. Under Solitaire's tableau. That reads fine while you are
 * writing it and it is wrong the moment a real table is on screen — the result and the button that
 * starts the next round land BELOW THE FOLD, so the answer to "did I win, and can I go again" is a
 * scroll. A game that has just ended is the one moment the player is certain to want a control, and
 * it was the one control they had to go looking for.
 *
 * WHY IT IS THE OS'S AND NOT EACH GAME'S. Exactly the argument `<Rematch>` makes one level up. That
 * component already took "who has to agree" away from the games because three of them had answered
 * it three ways; this takes WHERE THE ANSWER APPEARS, for the same reason — six panels is six
 * chances to put it below the fold, and the seventh game inherits the mistake by copying the sixth.
 * A game says WHAT happened (the verdict, any detail, what the buttons are); the OS decides where
 * it appears, and it appears over the page rather than under it.
 *
 * WHY A MODAL AND NOT A BANNER. It is the one surface that cannot be scrolled away from, on any
 * board of any height, without a game knowing how tall it is. The kit's `<Modal>` is a native
 * `<dialog>` in the top layer, so it cannot be clipped by a board's `overflow-hidden` felt or lose
 * a z-index fight with the top bar — the same reasons `src/ui` has exactly one modal.
 *
 * DISMISSIBLE, AND THAT IS NOT A CONCESSION. A result panel that covers the final position is
 * useless in chess and rude everywhere else, so Esc, the backdrop, × and "See the board" all close
 * it — and a pill stays pinned to the corner to bring it back. The ACTIONS never move: they are
 * rendered once, inside the dialog, whether it is open or not. That matters more than it looks.
 * `<Rematch>` fires the host's restart from an EFFECT once the tally agrees, and `restartGate`
 * re-arms on the agreement being lost rather than on a round number — so a mounted-but-hidden
 * Rematch keeps working, while moving it between two containers would remount it, re-arm the gate
 * against an already-agreed tally, and deal a second round (at a betting table: a second ante off
 * everybody). One mount, one place.
 *
 * A closed `<dialog>` is `display: none` and its children stay in the DOM, which is what makes that
 * true — and it is also why this component may be rendered unconditionally by a game rather than
 * only when its round ends.
 */

/** How the round went, from THIS reader's seat — a spectator or a bystander passes `draw`. */
export type ResultTone = 'win' | 'loss' | 'draw';

/**
 * The one accent the panel spends, and it is spent on the title rather than the box.
 *
 * Gold is money in this building, and a win is the moment money arrives — so the verdict takes the
 * neon gold the pot label uses and nothing else does. A loss and a draw are deliberately flat: the
 * glow budget is blue = act, cyan = here, gold = money, and a glowing "you lost" panel is a slot
 * machine congratulating you on losing. The box keeps `<Modal>`'s own border in every case, because
 * two border-colour utilities on one element is a fight decided by Tailwind's emit order rather
 * than by anybody's intention.
 */
const TONE_TITLE: Record<ResultTone, string> = {
  win: 'text-accent text-shadow-neon-gold',
  loss: 'text-base-content',
  draw: 'text-base-content',
};

export interface GameResultProps {
  /** The game's own answer to "is this round over". The panel opens on the transition into `true`. */
  readonly over: boolean;
  /** The verdict, in the game's own words: "Checkmate — you win.", "Dealer takes it." */
  readonly title: string;
  readonly tone?: ResultTone;
  /** Anything else worth saying — a podium, a payout, how many moves it took. Optional. */
  readonly detail?: ReactNode;
  /** The actions. `<Rematch>` for a room game, a plain "Deal again" for a solo one. */
  readonly children?: ReactNode;
}

export function GameResult({ over, title, tone = 'draw', detail, children }: GameResultProps) {
  const [dismissed, setDismissed] = useState(false);

  // A NEW ROUND RE-ARMS IT. Render-phase adjustment rather than an effect (the board's own
  // `seenRound` shape): dismissing round 4's result must not silently swallow round 5's.
  const [seen, setSeen] = useState(over);
  if (seen !== over) {
    setSeen(over);
    setDismissed(false);
  }

  const dismiss = () => {
    setDismissed(true);
  };

  return (
    <>
      <Modal
        open={over && !dismissed}
        onClose={dismiss}
        title={<span className={TONE_TITLE[tone]}>{title}</span>}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <Button variant="quiet" size="sm" onClick={dismiss}>
              See the board
            </Button>
            {children}
          </div>
        }
      >
        {detail}
      </Modal>

      {/* THE WAY BACK. Bottom LEFT on purpose: the toast host owns the bottom edge from the centre
          rightwards (`items-center` on a phone, `sm:items-end` on a desktop), and a control you
          have to wait out a toast to reach is the fold problem again in miniature.

          PORTALLED, and that is not tidiness. A game renders this from inside its board `<Card>`,
          and a Card with an equipped FELT carries `isolate` — a stacking context, so a `fixed`
          child of it paints INSIDE that context and can be occluded by any later sibling. The
          dialog above is immune (the top layer is not a z-index), this is not, and the failure
          would be a control that vanishes for exactly the players who bought a felt. `document.body`
          has no such context. */}
      {over &&
        dismissed &&
        createPortal(
          <div
            className={cx(
              'animate-rise fixed bottom-4 left-4 z-30 flex max-w-[calc(100vw-2rem)] items-center gap-3',
              'rounded-box border-bw-line bg-base-200 shadow-lift border px-4 py-2 sm:bottom-6 sm:left-6'
            )}
          >
            <span className={cx('font-display truncate text-sm font-semibold', TONE_TITLE[tone])}>
              {title}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setDismissed(false);
              }}
            >
              Show result
            </Button>
          </div>,
          document.body
        )}
    </>
  );
}
