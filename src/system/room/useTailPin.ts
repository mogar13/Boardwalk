import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A LOG THAT FOLLOWS ITS OWN TAIL — but only while you are reading the tail.
 *
 * Both halves are needed and each one alone is a bug. A log that does not follow shows you the deal
 * for the rest of the game; one that follows UNCONDITIONALLY yanks you out of scrollback every time
 * anybody does anything, which in UNO is roughly once a second. So: pinned by default, released by
 * scrolling up, and taken back by a control the caller draws (`missed` says how loud it should be).
 *
 * WHY IT IS A HOOK. There are two of these at a table now — the chat and the move log — and they
 * are the same behaviour to the pixel, including the `NEAR_BOTTOM_PX` slack that decides what still
 * counts as "at the bottom". The chat had it first and the move log had none at all (an
 * unconditional `scrollTop = scrollHeight` on every event, so reading back one turn was impossible:
 * the log yanked itself away mid-sentence). Collapsing them in the commit that first needs them to
 * agree is this repo's `<Avatar>` rule; the alternative is two slacks that drift.
 *
 * IT HANDS BACK A CALLBACK REF, NOT A REF OBJECT, and that is not a style choice: a hook returning
 * `{ ref, missed, pinned }` puts a ref object and render-time values in one bag, so `tail.missed`
 * in a caller's JSX is a property read on something ref-shaped and `react-hooks/refs` refuses the
 * whole component. `attach` keeps `current` inside this file, where the only two places it is
 * touched are an effect and a scroll handler; the caller cannot read it during render because it is
 * not there to read.
 *
 * **DESTRUCTURE IT AT THE CALL SITE** — `const { attach, onScroll, pinned, missed, pin } = …`.
 * Holding the whole object (`const tail = …; tail.missed`) makes the React compiler treat every
 * property read as a possible ref access and errors the component out. That is a slightly odd rule
 * to have to know, so it is written here rather than left to be rediscovered from a message about
 * refs on a line that does not mention one.
 *
 * @param count how many entries the caller is rendering. It may go DOWN — a new UNO round clears
 *   the log — and that case is handled below, because it is the one that silently breaks `missed`.
 */

/** How close to the bottom still counts as reading the live end rather than scrollback. */
const NEAR_BOTTOM_PX = 48;

export interface TailPin<T extends HTMLElement> {
  /** Put this on the scrolling box: `ref={tail.attach}`. */
  readonly attach: (el: T | null) => void;
  /** And this: releasing the pin is a scroll gesture, so only the box can report it. */
  readonly onScroll: () => void;
  /** Reading the live end. A caller draws its "jump to now" control while this is false. */
  readonly pinned: boolean;
  /** Entries that arrived while you were reading back. Always 0 while pinned. */
  readonly missed: number;
  /** Take the pin back — sending a message, or pressing the control. */
  readonly pin: () => void;
}

export function useTailPin<T extends HTMLElement>(count: number): TailPin<T> {
  const box = useRef<T | null>(null);
  const [pinned, setPinned] = useState(true);
  const [seen, setSeen] = useState(0);

  // A COUNT THAT WENT DOWN is a fresh log, not a read one — UNO's move log empties on every deal.
  // Without this, `seen` stays at the old round's high-water mark while unpinned, so `missed` reads
  // 0 through the whole of the next round and the "jump to now" control quietly says nothing is
  // happening. Adjusted during render (the board's own `seenRound` pattern) rather than in an
  // effect, so no frame is ever painted from the stale number.
  if (seen > count) setSeen(count);

  useEffect(() => {
    const el = box.current;
    if (el === null || !pinned) return;
    el.scrollTop = el.scrollHeight;
    setSeen(count);
  }, [count, pinned]);

  const attach = useCallback((el: T | null) => {
    box.current = el;
  }, []);

  const onScroll = useCallback(() => {
    const el = box.current;
    if (el === null) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX);
  }, []);

  const pin = useCallback(() => {
    setPinned(true);
  }, []);

  return { attach, onScroll, pinned, missed: Math.max(0, count - seen), pin };
}
