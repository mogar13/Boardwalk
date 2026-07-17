import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '@/ui/cx';

/**
 * A button is a sign on the pier. It is either lit, or it is glass waiting to be.
 *
 * WHY THE VARIANTS ARE A RECORD AND NOT CONDITIONALS. ARCHITECTURE.md is explicit
 * about this, and the reason is that `variant === 'primary' && 'bg-primary'` chains
 * let two variants quietly both apply, and let a third be added without deciding
 * what it looks like against the other two. A `Record<ButtonVariant, string>` is
 * exhaustive by type: add a member to ButtonVariant and this file stops compiling
 * until someone has an opinion about it. That is the whole "fix by type, not by
 * convention" rule, applied to the smallest possible thing.
 *
 * WHY `primary` IS THE ACTION, NOT AN INFORMATION COLOUR. VS-Dashboard's trap, worth
 * restating: they reserve blue for information and never for action, so DaisyUI's
 * `btn-primary` — which is blue — is a lint error there and <Button variant="primary">
 * is orange. Same shape here. `primary` is the ACTION. On this theme the action now
 * happens to also be blue, which sharpens the point rather than softening it: it is the
 * GLOW and the one-per-view discipline that make this the action, never the hue. A flat
 * blue would read as information; this lit blue tube reads as the thing to press. If you
 * want the DaisyUI meaning of a word, you want a different word.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Shared by every variant. Notably NOT here: any colour. A variant that forgets to
 * name its own colour should look broken, not inherit a default — a default here is
 * how you end up with a button nobody chose the appearance of.
 */
const BASE = cx(
  'inline-flex items-center justify-center gap-2 rounded-field',
  // Signage: uppercase, tracked out, condensed where the face allows. This — not
  // the glow — is what carries the boardwalk read on a system font.
  'font-display text-sm font-semibold tracking-[0.14em] uppercase',
  'whitespace-nowrap select-none',
  // Enumerated, not `transition-all`. `all` animates properties you did not choose
  // (height on a font swap, width on a label change), and those reflows are the
  // jank nobody can find later.
  'transition-[background-color,border-color,color,box-shadow,transform,filter]',
  'duration-200 ease-strike',
  // The tactile 1px. A sign you press should move like one.
  'active:translate-y-px',
  // Disabled is UNLIT AND DRAINED. Opacity alone is not enough on this palette:
  // the lit primary at 40% over a dark base is still among the most saturated things
  // on screen, so it keeps drawing the eye to the one control that does nothing. `saturate-0`
  // is what actually removes it from the hierarchy.
  'disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none disabled:saturate-0'
);

const VARIANTS: Record<ButtonVariant, string> = {
  // The lit tube. This is the only `bg-primary` tube on the page, and there should be
  // one per view — "which button is the action" is a question the design answers, not
  // the user. `inset-shadow-rim` is the giveaway that sells it as lit glass rather
  // than a flat blue rectangle: light catches the top edge of a tube, never the bottom.
  primary: cx(
    'bg-primary text-primary-content',
    'shadow-glow-primary inset-shadow-rim',
    'hover:brightness-110 hover:shadow-glow-primary-hot'
  ),

  // The counterweight. Same construction, cyan gas.
  secondary: cx(
    'bg-secondary text-secondary-content',
    'shadow-glow-secondary inset-shadow-rim',
    'hover:brightness-110 hover:shadow-glow-secondary-hot'
  ),

  // THE UNLIT TUBE — glass with no gas in it, which is what most of a real pier is
  // in daylight. Hover strikes it. This is the single best thing in the theme: it
  // makes hover mean something physical instead of "a bit lighter now", and it is
  // why the page can carry a dozen buttons without becoming a ransom note. Only the
  // one you are touching is on.
  ghost: cx(
    'border-bw-line-strong text-base-content border bg-transparent',
    'hover:border-secondary hover:text-secondary hover:shadow-glow-secondary'
  ),

  // Lit red. Glows, because destruction is an action.
  danger: cx(
    'bg-error text-error-content',
    'shadow-glow-error inset-shadow-rim',
    'hover:brightness-110'
  ),

  // No tube at all. Cancel, dismiss, "not now" — the thing next to the real action.
  // It must not compete: no border, no glow, muted until touched.
  quiet: cx('text-bw-muted bg-transparent', 'hover:bg-base-300 hover:text-base-content'),
};

/**
 * Heights are fixed rather than padding-derived so a row of buttons lines up even
 * when one has an icon and another does not.
 */
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-5',
  lg: 'h-12 px-7 text-base',
};

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to the container. Modal footers and bet racks want this. */
  block?: boolean;
  children?: ReactNode;
  /**
   * Escape hatch for LAYOUT ONLY — margins, grid placement, width. Colour and
   * glow come from `variant`, and `no-raw-palette` will reject the interesting
   * ways of getting around that. See cx() on why this does not merge.
   */
  className?: string;
}

export function Button({
  variant = 'ghost',
  size = 'md',
  block = false,
  // `type` defaults to "submit" in HTML, which means a bare <Button> inside any
  // <form> submits it. That default has never once been what someone wanted from a
  // component named Button, and it fails in the least reproducible way: only inside
  // a form, only on the button you forgot.
  type = 'button',
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(BASE, VARIANTS[variant], SIZES[size], block && 'w-full', className)}
      {...rest}
    />
  );
}
