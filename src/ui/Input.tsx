import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cx } from '@/ui/cx';

/**
 * A text field. Recessed, not raised — the inverse of Card.
 *
 * `inset-shadow-well` is `inset-shadow-rim` upside down: a card catches light on
 * its top edge because it stands proud of the page; a field is cut INTO the page,
 * so its top edge is in shadow. That single inversion is the whole difference
 * between "a box you type in" and "a box". Both come from the theme, so they cannot
 * drift apart.
 *
 * WHY label/hint/error ARE PROPS AND NOT YOUR JOB. Because a bare styled <input> is
 * not a component, it is a skin — every consumer then hand-rolls the <label>, and
 * some of them forget, and now the field has no accessible name and nothing catches
 * it. The wiring here (useId → htmlFor, aria-describedby, aria-invalid) is the part
 * that is tedious and skippable, which is exactly the part a kit should own. Passing
 * neither `label` nor `aria-label` is a type error below, not a code review note.
 */
type InputBase = Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'id'>;

interface InputCommon extends InputBase {
  /** Shown under the field. Suppressed while `error` is set — see below. */
  hint?: ReactNode;
  /**
   * The field is wrong, and this says how. Presence flips the styling AND sets
   * aria-invalid, so the two can never disagree.
   *
   * Say what is wrong, not that something is: "Bet more than $2" beats "Invalid".
   */
  error?: ReactNode;
  className?: string;
}

/**
 * Named or nothing. A field with no accessible name is unusable by a screen reader,
 * and it is the single most common a11y defect in every kit that made `label`
 * optional. This union makes the broken call fail to compile: pass a visible
 * `label`, or pass `aria-label` and say why it is not visible.
 */
export type InputProps =
  | (InputCommon & { label: ReactNode; 'aria-label'?: never })
  | (InputCommon & { label?: never; 'aria-label': string });

const FIELD = cx(
  'rounded-field border-bw-line bg-base-300 w-full border px-3 py-2',
  'text-base-content placeholder:text-bw-muted/70',
  'inset-shadow-well',
  'transition-[border-color,box-shadow] duration-200 ease-strike',
  // Cyan on focus — "you are here", the same meaning it has everywhere else. The
  // theme's global :focus-visible outline is suppressed because this draws its own
  // (a 2px outline outside a glowing border reads as two rings).
  'focus:border-secondary focus:shadow-glow-secondary focus:outline-none',
  'disabled:cursor-not-allowed disabled:opacity-50'
);

const FIELD_ERROR = cx(
  'border-error/70 shadow-glow-error',
  'focus:border-error focus:shadow-glow-error'
);

export function Input({ label, hint, error, className, ...rest }: InputProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  // Only one message shows. Rendering the hint under a red field means the user
  // reads the advice they already failed to follow, and the actual problem is the
  // second line down.
  const message = error ?? hint;
  const messageId = error ? errorId : hintId;

  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      {label !== undefined && (
        <label
          htmlFor={id}
          className="font-display text-bw-muted text-xs font-semibold tracking-[0.12em] uppercase"
        >
          {label}
        </label>
      )}
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={message !== undefined ? messageId : undefined}
        // Ternary, not `error && FIELD_ERROR`: `error` is a ReactNode, and
        // ReactNode includes 0 — so `&&` yields the number 0, not false. tsc caught
        // it; the runtime would not have.
        className={cx(FIELD, error ? FIELD_ERROR : undefined)}
        {...rest}
      />
      {message !== undefined && (
        <p
          id={messageId}
          // aria-live only on the error: a hint is there before you arrive and
          // announcing it on every keystroke is noise. An error appears in response
          // to something you did, which is exactly what "polite" is for.
          {...(error ? { role: 'status', 'aria-live': 'polite' as const } : {})}
          className={cx('text-xs', error ? 'text-error' : 'text-bw-muted')}
        >
          {message}
        </p>
      )}
    </div>
  );
}
