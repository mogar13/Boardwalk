import { useEffect, useRef } from 'react';

/**
 * DRAW FOR A PLAYER WHO HAS NO OTHER MOVE. When a hand holds nothing playable, `applyMove` refuses
 * every play and accepts exactly one action — and drawing ENDS the turn in this rulebook, so there
 * is nothing after it to choose either. The click was therefore mandatory, and a mandatory click is
 * friction, not agency: the table just sat there until the player worked out that the dimmed fan
 * meant "go and press the deck".
 *
 * WHY IT IS ARMED BY A KEY RATHER THAN A BOOLEAN. The effect must fire once per stuck TURN, and the
 * obvious `[stuck, state, hand]` dependency list re-runs on every republish — including the echo of
 * the player's own pending intent — so the cleanup would cancel the timer and re-arm it from zero,
 * and a table that republishes faster than the beat would never draw at all. A string key changes
 * only when the position does (`round:eventSeq`, the host's own move counter), so a re-render with
 * the same key is not a new arming. `null` disarms — it is not my turn, or I have a card to play.
 *
 * The deck running dry is the case that decides the shape: `applyMove` returns the game UNCHANGED
 * when nothing can be drawn, so the event seq does not move, so the key does not change, so this
 * fires exactly once and stops rather than spinning on a pile that cannot serve it.
 *
 * `draw` is held in a ref because it closes over the board's state and is a fresh function every
 * render; putting it in the dependency list would re-arm the timer on every render, which is the
 * same bug in a different costume.
 */

/** Long enough to read what happened before the turn moves on. Matches the bots' `AI_DELAY_MS`. */
const AUTO_DRAW_MS = 900;

export function useAutoDraw(armKey: string | null, draw: () => void): void {
  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
  });

  useEffect(() => {
    if (armKey === null) return;
    const timer = setTimeout(() => {
      drawRef.current();
    }, AUTO_DRAW_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [armKey]);
}
