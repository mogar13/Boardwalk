import { cx } from '@/ui';

/**
 * CALL UNO — the one control on this board that is a DECISION rather than a move.
 *
 * It arms BEFORE the play that takes you to one card, because that is when the rulebook decides the
 * penalty (`declareUno` rides on the move). v1 let you yell after the fact; the decision point is
 * the same one, it just has to be made a beat earlier.
 *
 * WHY THIS IS NOT `<Button>`. The kit's `className` is documented as an escape hatch for LAYOUT
 * ONLY — "colour and glow come from `variant`" — and this control's whole point is a glow no kit
 * variant has. The two honest ways to get one are a `uno` variant in `src/ui`, which would put a
 * game's vocabulary in the shared kit, or a control the game draws itself out of theme tokens. The
 * board already draws the wild-colour picker that way for the same reason, and `no-daisyui-classes`
 * keeps the line real: this file may name `bg-warning`, never `btn-warning`.
 *
 * WHY IT GLOWS AMBER AND NOT GOLD. Gold is money and this wins you none — the theme's rule, and the
 * pot label two elements up is what gold is for. Amber is already UNO's colour for "one card left",
 * so `--shadow-glow-uno` lights the button that commits to exactly the state the amber labels. It
 * adds no hue to a glow budget CLAUDE.md calls nearly spent.
 *
 * THE PULSE IS ONLY ON THE UNARMED STATE, and that is the whole interaction: unarmed it is a thing
 * asking to be pressed, armed it is a thing that has been. A control that keeps flashing after you
 * have answered it is a notification you cannot dismiss.
 */

export interface CallUnoProps {
  readonly armed: boolean;
  readonly onToggle: () => void;
}

export function CallUno({ armed, onToggle }: CallUnoProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={armed}
      className={cx(
        'font-display rounded-field inline-flex h-9 items-center border-2 px-5 text-xs font-black tracking-[0.18em] uppercase',
        'ease-strike transition-[background-color,color,filter] duration-200 active:translate-y-px',
        'focus-visible:outline-secondary focus-visible:outline-2 focus-visible:outline-offset-4',
        'shadow-glow-uno',
        armed
          ? 'border-warning bg-warning text-warning-content inset-shadow-rim'
          : 'border-warning text-warning bg-base-300 animate-lastcard hover:brightness-125'
      )}
    >
      {armed ? 'UNO! armed — play your card' : 'Call UNO!'}
    </button>
  );
}
