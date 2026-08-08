import { Button, cx } from '@/ui';
import { TableAside } from '@/system/room/TableAside';
import { useTailPin } from '@/system/room/useTailPin';
import { cardLabel } from '@/games/uno/log';
import type { LogLine } from '@/games/uno/log';
import type { UnoColor } from '@boardwalk/game-logic/games/uno';

/**
 * THE RUNNING COMMENTARY. v1's `#move-log`, and in a hidden-hand game it is not decoration: the
 * cards are face down, so the log is the only place the table ever says out loud that CPU 3 drew
 * four and lost their turn. Without it a bot's turn is a half-second in which something happened to
 * somebody.
 *
 * IT LIVES IN THE SIDEBAR, under the chat, and that is the whole of what changed. It used to be a
 * short strip at the BOTTOM of the board, below the player's own fan — which is the one place it
 * cannot be: the fan is the element that grows, so on a real table the commentary was permanently
 * off the bottom of the screen, and the ~7rem it took was taken from the felt it exists to comment
 * on. The column beside the board already holds the table's other running text. See `<TableAside>`.
 *
 * IT FOLLOWS ITS OWN TAIL, but only while you are reading the tail. It used to slam `scrollTop` to
 * the end on every single event, so reading back one turn to see what a bot did was impossible —
 * the log yanked itself away mid-sentence, roughly once a second. That is the chat's problem
 * exactly, the chat had already solved it, and the fix is now the same lines of code for both:
 * `useTailPin`, which also supplies the "N new ↓" control that stops an unpinned reader being
 * stranded at the top of a log that is still moving.
 *
 * THE COLOUR WORD IS NOT SHOUTED. A card's label is PAINTED in its own colour (v1 regex-replaced
 * RED/BLUE/GREEN/YELLOW in the message string; here the card is a value on the event, so the label
 * is coloured by knowing what it is rather than by matching what it says) — so setting it in caps
 * as well says the same thing twice, loudly, on the one surface that is meant to be read quickly.
 * `cardLabel` sets it in title case; the colour carries the colour.
 */

const CARD_TEXT: Record<UnoColor | 'wild', string> = {
  red: 'text-uno-red',
  blue: 'text-uno-blue',
  green: 'text-uno-green',
  yellow: 'text-uno-yellow',
  wild: 'text-base-content',
};

export interface MoveLogProps {
  readonly lines: readonly LogLine[];
  /** My own seat, so my moves read differently from everyone else's. */
  readonly mySeat: number;
}

export function MoveLog({ lines, mySeat }: MoveLogProps) {
  const { attach, onScroll, pinned, missed, pin } = useTailPin<HTMLDivElement>(lines.length);

  return (
    <TableAside
      title="Move log"
      scroll={{ attach, onScroll }}
      footer={
        /* THE WAY BACK DOWN, and it is the chat's own control rather than a second design — same
           component, same weight rule (cyan when something actually arrived while you were reading
           back, quiet when it is only a way down from a log nobody has added to). Without it,
           releasing the pin on scroll strands a reader at the top of a log that is still moving,
           with no sign that it is. */
        !pinned && (
          <Button
            variant={missed > 0 ? 'secondary' : 'quiet'}
            size="sm"
            className="w-full"
            onClick={pin}
          >
            {missed > 0 ? `${String(missed)} new \u2193` : 'Latest \u2193'}
          </Button>
        )
      }
    >
      {lines.length === 0 && (
        <p className="text-bw-muted text-xs">The deal is done. Play a card or draw.</p>
      )}
      {lines.map((line) => (
        <p
          key={line.key}
          className={cx(
            'text-xs leading-relaxed',
            line.system ? 'text-bw-muted' : 'text-base-content'
          )}
        >
          <span
            className={cx(line.seat === mySeat && !line.system && 'text-secondary font-semibold')}
          >
            {line.text}
          </span>
          {line.card !== null && (
            <>
              {' '}
              <span className={cx('font-semibold', CARD_TEXT[line.card.color])}>
                {cardLabel(line.card)}
              </span>
            </>
          )}
        </p>
      ))}
    </TableAside>
  );
}
