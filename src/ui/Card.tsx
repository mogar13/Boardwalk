import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '@/ui/cx';

/**
 * A surface. The felt, the table, the panel a game sits on.
 *
 * THE ONE IDEA: a card is lit from above, not filled lighter. The instinct on a
 * dark UI is to make a raised thing a paler grey, but past a few percent that stops
 * reading as "closer" and starts reading as "a hole in the page" — you get a window
 * into a lighter room rather than an object in this one. So the fill barely moves
 * (base-200, one step off the room) and the elevation comes from `inset-shadow-rim`:
 * a 1px highlight on the TOP edge only, because that is where light lands. It is a
 * rule you can check against any physical object nearby.
 *
 * A card never glows. The room is dark, the signs glow, the furniture does not — if
 * the surface a button sits on is also lit, the button stops being the brightest
 * thing in its neighbourhood and the hierarchy is gone. `interactive` is the one
 * exception, and only on hover, and only cyan (= "here"), never the primary (= "act"):
 * a hovered card is a location, not a verb.
 */
export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'className'> {
  /**
   * The card is a link or a target — lifts and takes a cyan edge on hover.
   *
   * This does NOT make it clickable. It is presentation only: put the <button> or
   * <a> inside, or make the consumer one. A div with an onClick is invisible to a
   * keyboard and to a screen reader, and "the whole card is clickable" is the most
   * common way that ships.
   */
  interactive?: boolean;
  /**
   * An equipped FELT image URL to lay over the surface, or `null` for none (the default, and the
   * plain panel this component has always been). P5's `felt` cosmetic; the five game boards pass
   * `useEquippedFelt()` straight in.
   *
   * The kit takes a URL, never a cosmetic id and never the profile — same split as `cardBackSrc`:
   * `@/system/felt/felts` owns id→file, the reader hook knows about the player, and `src/ui` stays
   * a kit that knows about neither. A Card cannot ask who is signed in.
   *
   * It is drawn MUTED (`opacity-80`) over `bg-base-200` rather than at full strength. The theme's
   * contrast pairs — `text-base-content` and friends — are all computed against the base surfaces,
   * so a felt at full opacity would quietly become a new background colour that nothing has
   * checked text against. Muting it over the existing dark base keeps every one of those pairs
   * valid and lets the felt read as a texture on the table, which is what a felt is.
   */
  felt?: string | null;
  children?: ReactNode;
  /** Layout only — see Button.className. */
  className?: string;
}

const BASE = cx(
  'rounded-box border-bw-line bg-base-200 border',
  'inset-shadow-rim',
  'transition-[border-color,box-shadow,transform] duration-200 ease-strike'
);

const INTERACTIVE = cx(
  'hover:border-secondary/60 hover:shadow-glow-secondary hover:-translate-y-0.5',
  // Keyboard parity: whatever hover does, focus-within must also do, or the effect
  // is decoration for mouse users and the tab order looks broken.
  'focus-within:border-secondary/60 focus-within:shadow-glow-secondary'
);

export function Card({
  interactive = false,
  felt = null,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={cx(
        BASE,
        interactive && INTERACTIVE,
        // `isolate` is the load-bearing half of this pair. The felt sits at `-z-10` so it lands
        // behind the card's own content without needing a z-index on every child — but without a
        // stacking context that -10 would escape the Card and slide behind the PAGE, where the
        // body background hides it and the felt silently does nothing. `overflow-hidden` keeps the
        // image inside the rounded corners.
        felt !== null && 'relative isolate overflow-hidden',
        className
      )}
      {...rest}
    >
      {felt !== null && (
        <img
          src={felt}
          alt=""
          className="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover opacity-80"
        />
      )}
      {children}
    </div>
  );
}
