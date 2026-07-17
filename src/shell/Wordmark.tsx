import { cx } from '@/ui';

/**
 * The sign. "THE BOARDWALK", lit magenta — the same optical trick as App.tsx's Phase 1
 * hero and for the same reason: the letters are `base-content` (near-white) and every bit
 * of magenta lives in `text-shadow`, because a real neon tube reads WHITE at its core and
 * throws the gas colour into the air around it. Setting the text itself magenta is the tell
 * that separates CSS neon from a sign.
 *
 * It appears in two places — small in the top bar, large on the signed-out screen — so it
 * is a component with a `size`, not two copies that will drift the way v1's cosmetics did.
 */
export function Wordmark({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <span
      className={cx(
        'font-display text-base-content text-shadow-neon font-bold uppercase',
        size === 'sm' ? 'text-lg tracking-[0.12em]' : 'text-5xl tracking-[0.08em] sm:text-7xl'
      )}
    >
      The Boardwalk
    </span>
  );
}
