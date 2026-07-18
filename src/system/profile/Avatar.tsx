import type { Rarity } from '@boardwalk/game-logic';
import { cx } from '@/ui';
import { RARITY_RING } from '@/system/store/rarity';

/**
 * A player's avatar emoji, optionally inside a FRAME ring (P5's `frame` cosmetic).
 *
 * WHY THIS COMPONENT EXISTS. Before P5 the avatar was three copies of
 * `<span className="text-{xl,2xl,4xl}" aria-hidden>{emoji}</span>` — top bar, leaderboard row,
 * profile card. A frame ring drawn in three places is three places to drift, so the three copies
 * became one component in the commit that first needed them to agree. It lives in
 * `system/profile` rather than `src/ui` because it is not a kit primitive: it knows what a
 * cosmetic rarity is, which the kit deliberately does not.
 *
 * IT TAKES A FRAME, IT DOES NOT READ ONE. The caller passes `frame`, so the same component serves
 * your own avatar (top bar, profile card — `useEquippedFrame()`) and other players' (the
 * leaderboard, which passes nothing because their frame is not projected). A component that read
 * the store itself could only ever draw the signed-in player.
 *
 * THE RING IS FLAT AND NEVER GLOWS. It borrows the rarity tokens (see `RARITY_RING`), which are
 * flat by construction. An avatar that glowed would be competing with the three signals that mean
 * something — act, here, money — and CLAUDE.md is explicit that if everything glows, nothing does.
 */
export interface AvatarProps {
  /** The emoji that IS the avatar — `profile.avatar`, or a leaderboard entry's. */
  emoji: string;
  /** Render size. Matches the three call sites the component replaced. */
  size: 'sm' | 'md' | 'lg';
  /** The frame tone to ring it with, or `null`/absent for a bare avatar (the default). */
  frame?: Rarity | null;
}

/** `sm` = top bar, `md` = leaderboard row, `lg` = profile card — the sizes those sites already used. */
const SIZE: Record<AvatarProps['size'], string> = {
  sm: 'text-xl',
  md: 'text-2xl',
  lg: 'text-4xl',
};

/**
 * Ring padding, per size. A ring needs air or it reads as a box drawn on the emoji rather than a
 * frame around it, and the gap has to scale with the glyph or the big one looks strangled.
 */
const RING_PAD: Record<AvatarProps['size'], string> = {
  sm: 'p-1',
  md: 'p-1.5',
  lg: 'p-2',
};

export function Avatar({ emoji, size, frame = null }: AvatarProps) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center justify-center leading-none',
        SIZE[size],
        // With no frame this collapses to exactly the bare span these call sites rendered before
        // P5 — no border, no padding, no layout shift for a player who owns no frame. That is the
        // property that let this ship to a live app without repositioning anyone's top bar.
        frame !== null && cx('rounded-full border-2', RING_PAD[size], RARITY_RING[frame])
      )}
      aria-hidden
    >
      {emoji}
    </span>
  );
}
