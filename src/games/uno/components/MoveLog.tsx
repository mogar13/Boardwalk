import { useEffect, useRef } from 'react';
import { cx } from '@/ui';
import { cardLabel } from '@/games/uno/log';
import type { LogLine } from '@/games/uno/log';
import type { UnoColor } from '@boardwalk/game-logic/games/uno';

/**
 * THE RUNNING COMMENTARY. v1's `#move-log`, and in a hidden-hand game it is not decoration: the
 * cards are face down, so the log is the only place the table ever says out loud that AI 3 drew four
 * and lost their turn. Without it a bot's turn is a half-second where something happened to somebody.
 *
 * It PINS TO THE BOTTOM the way a chat does, and that is the whole of the behaviour worth writing
 * down: a log that does not follow its own tail shows you the deal for the rest of the game.
 *
 * Colour words are painted with the UNO tokens (v1 regex-replaced RED/BLUE/GREEN/YELLOW in the
 * message string — here the card is a value on the event, so the label is coloured by knowing what
 * it is rather than by matching what it says).
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
  const box = useRef<HTMLDivElement>(null);
  const count = lines.length;

  useEffect(() => {
    const el = box.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [count]);

  return (
    <div
      ref={box}
      className="border-bw-line bg-base-100/60 inset-shadow-well h-24 w-full max-w-md overflow-y-auto rounded-box border px-3 py-2 text-xs leading-relaxed"
      aria-live="polite"
      aria-label="Move log"
    >
      {count === 0 && <p className="text-bw-muted">The deal is done. Play a card or draw.</p>}
      {lines.map((line) => (
        <p key={line.key} className={cx(line.system ? 'text-bw-muted' : 'text-base-content')}>
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
    </div>
  );
}
