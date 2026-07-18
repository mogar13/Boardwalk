import { useId, useState } from 'react';
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

export function Input({ label, hint, error, className, type, ...rest }: InputProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  // The reveal toggle: a password field, and nothing else, gets the eye. We key off
  // the ORIGINAL prop (not the live input type) — once revealed the element is a
  // `text` input, so asking "is this a password field" of the live type would make
  // the button vanish the instant it's used. `isPassword` is that question asked of
  // intent, which is stable. A non-password field never pays for any of this: no
  // state, no wrapper button, no extra padding.
  const isPassword = type === 'password';
  const [revealed, setRevealed] = useState(false);
  const effectiveType = isPassword && revealed ? 'text' : type;

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
      <div className="relative">
        <input
          id={id}
          type={effectiveType}
          aria-invalid={error ? true : undefined}
          aria-describedby={message !== undefined ? messageId : undefined}
          // Ternary, not `error && FIELD_ERROR`: `error` is a ReactNode, and
          // ReactNode includes 0 — so `&&` yields the number 0, not false. tsc caught
          // it; the runtime would not have. `pr-11` only on a password field, so the
          // text never runs under the toggle; other fields keep their normal padding.
          className={cx(FIELD, isPassword && 'pr-11', error ? FIELD_ERROR : undefined)}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            // NOT in the tab order: a keyboard user tabbing through the form wants
            // the next field, not a detour through a reveal toggle they didn't ask
            // for. It's still clickable, and screen readers reach it in browse mode.
            tabIndex={-1}
            onClick={() => {
              setRevealed((r) => !r);
            }}
            // aria-pressed makes it a toggle to a screen reader, not a button that
            // fires once; the label says what the NEXT press does.
            aria-pressed={revealed}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            className={cx(
              'text-bw-muted hover:text-base-content absolute inset-y-0 right-0 flex items-center px-3',
              'transition-colors duration-200 ease-strike',
              'focus-visible:text-secondary focus-visible:outline-none'
            )}
          >
            <EyeIcon off={revealed} />
          </button>
        )}
      </div>
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

/**
 * Eye / eye-with-a-slash, inline. No icon dependency for two glyphs — the same call
 * `cx` makes for itself. `currentColor` and `none` only, never a hex: the button
 * owns the colour through `text-*`, so `no-raw-palette` stays satisfied and the icon
 * inherits hover/focus for free. `off` draws the slash — shown WHILE revealed, the
 * standard "click to hide" affordance.
 */
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-4 w-4"
    >
      {off ? (
        <>
          <path d="M9.9 5.2A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.7 17.7 0 0 1-2.4 3.4M6.6 6.6A17.7 17.7 0 0 0 2 12s3.5 7 10 7a10.9 10.9 0 0 0 3.3-.5" />
          <path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
          <path d="M3 3l18 18" />
        </>
      ) : (
        <>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}
