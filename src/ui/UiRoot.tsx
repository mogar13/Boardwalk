import { useEffect } from 'react';
import { cx } from '@/ui/cx';
import { Button } from '@/ui/Button';
import { Modal } from '@/ui/Modal';
import { useToastList, useToast } from '@/ui/useToast';
import type { ToastTone } from '@/ui/useToast';
import { usePendingConfirm, registerConfirmHost, resolveConfirm } from '@/ui/useConfirm';

/**
 * Everything the kit needs mounted, mounted once. Put it at the app root.
 *
 * WHY ONE COMPONENT AND NOT <Toaster /> + <ConfirmHost />. Because forgetting one
 * of two mounts is twice as likely as forgetting one of one — and the failure modes
 * are not symmetric. A missing toaster is invisible (toasts pile up in a store
 * nobody reads); a missing confirm host would hang every caller on a promise that
 * never settles. One import, one line, one thing to forget. useConfirm's host count
 * turns even that into a console error rather than a hang.
 *
 * This is the same instinct as v1's `SystemUI.init()` being called by 31 games —
 * inverted. The shell injects the chrome once; nothing else opts in.
 */

/**
 * STATUS COLOURS DO NOT GLOW. This is the theme's central restraint and the toast
 * is where it is most tempting to break: a neon success toast is a slot machine
 * telling you your settings saved. Toasts are flat, dark, and carry one lit edge —
 * the tone is a 2px rule on the left, not a halo. The glow budget belongs to the
 * primary button and the bankroll, and it only means anything because nothing else
 * spends it.
 */
const TONE_EDGE: Record<ToastTone, string> = {
  info: 'border-l-info',
  success: 'border-l-success',
  warning: 'border-l-warning',
  error: 'border-l-error',
};

const TONE_TEXT: Record<ToastTone, string> = {
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
};

const TONE_LABEL: Record<ToastTone, string> = {
  info: 'Note',
  success: 'Nice',
  warning: 'Heads up',
  error: 'Problem',
};

function Toasts() {
  const toasts = useToastList();
  const { dismiss } = useToast();

  return (
    // `pointer-events-none` on the stack, `auto` on each toast: the container spans
    // a whole corner of the viewport, and without this it eats clicks on whatever
    // is underneath even when empty. That bug is invisible until someone cannot
    // press a button in the corner and nobody can work out why.
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end"
      // aria-live on the CONTAINER, which must exist in the DOM before the toast
      // does. A live region added at the same moment as its content announces
      // nothing in most screen readers — the region has to be there to observe the
      // mutation. This is why the stack renders even when empty.
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            'pointer-events-auto flex w-full max-w-sm items-start gap-3',
            'rounded-field border-bw-line bg-base-200/95 border border-l-2 backdrop-blur-sm',
            'inset-shadow-rim shadow-lift px-4 py-3',
            'animate-rise',
            TONE_EDGE[t.tone]
          )}
        >
          <div className="min-w-0 flex-1">
            <p
              className={cx(
                'font-display text-[0.7rem] font-semibold tracking-[0.14em] uppercase',
                TONE_TEXT[t.tone]
              )}
            >
              {TONE_LABEL[t.tone]}
            </p>
            <p className="text-base-content mt-0.5 text-sm break-words">{t.message}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              dismiss(t.id);
            }}
            aria-label="Dismiss"
            className="text-bw-muted hover:text-base-content -mt-1 -mr-1 shrink-0 p-1 leading-none transition-colors"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function ConfirmHost() {
  const pending = usePendingConfirm();

  useEffect(() => registerConfirmHost(), []);

  return (
    <Modal
      // `open` is driven by the store, and the `key` remounts per request so a
      // second confirm cannot inherit the first's exit animation mid-flight.
      key={pending?.id ?? 'idle'}
      open={pending !== null}
      onClose={() => {
        resolveConfirm(false);
      }}
      title={pending?.title ?? ''}
      {...(pending?.body !== undefined ? { description: pending.body } : {})}
      footer={
        <>
          <Button
            variant="quiet"
            onClick={() => {
              resolveConfirm(false);
            }}
          >
            {pending?.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            // The action carries the weight, so it is the thing that glows.
            variant={pending?.destructive ? 'danger' : 'primary'}
            onClick={() => {
              resolveConfirm(true);
            }}
          >
            {pending?.confirmLabel ?? ''}
          </Button>
        </>
      }
    />
  );
}

export function UiRoot() {
  return (
    <>
      <Toasts />
      <ConfirmHost />
    </>
  );
}
