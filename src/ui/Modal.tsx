import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { cx } from '@/ui/cx';

/**
 * The one modal. v1 has four.
 *
 * WHY NATIVE <dialog> AND NOT A DIV IN A PORTAL. Everything a hand-rolled modal
 * gets wrong, the platform already does: focus moves in and is trapped; the page
 * behind goes inert (not "aria-hidden and hope"); Esc closes; it renders in the top
 * layer so it cannot be clipped by an ancestor's overflow or lose a z-index fight
 * with a sticky HUD. Every one of those is a bug v1's modals have, and every one is
 * a line we do not write. The whole component below is ~60 lines because the hard
 * parts are not ours.
 *
 * WHY `title` IS REQUIRED. It is the accessible name — without it the dialog
 * announces as "dialog" and a screen reader user is told a box appeared, with no
 * indication of what it wants. Making it optional means it is missing on the modal
 * someone wrote in a hurry, which is every modal.
 *
 * THE STRUCTURE: <dialog> fills the viewport and is transparent; the visible box is
 * a child. That is what makes "click the backdrop to dismiss" a target check
 * (`e.target === dialog`) instead of the getBoundingClientRect() arithmetic the
 * usual approach needs — which silently breaks the first time anyone adds padding
 * or a transform. ::backdrop still paints behind it, so the dim and blur are free.
 *
 * THREE WIDTHS, NOT A `className` WIDTH. Every dialog in the app used to be pinned
 * to one width, which is fine for a confirm and wrong for a panel — the launch
 * modal's setup step (plans/done/GAME_LAUNCH_MODAL.md §3) holds a seat picker, a stake
 * row, house-rule toggles and a seat preview, and at `max-w-lg` that is a form you
 * scroll. The fix is three rungs and not a free width, for the reason the kit
 * exists at all: a per-caller width is how five modals end up five sizes.
 */
export interface ModalProps {
  open: boolean;
  /**
   * Called for every dismissal — Esc, backdrop, the close button. `open` stays the
   * single source of truth: the dialog is never allowed to close itself behind
   * React's back (see the onCancel handler).
   */
  onClose: () => void;
  /** The accessible name. Required — see above. */
  title: ReactNode;
  /** Optional line under the title. Say the stakes here. */
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons. Put the primary action last — it sits nearest the thumb. */
  footer?: ReactNode;
  /** How wide the box may grow. Defaults to `'md'`, which is the width every dialog had. */
  size?: ModalSize;
  className?: string;
}

/**
 * The three rungs, and the ONLY place a modal's width is named.
 *
 * Each value must be a `max-w-*` Tailwind really generates — it builds them from its
 * `--container-*` theme namespace, and an unmatched one emits nothing at all, silently, leaving
 * the box at whatever width it already had. That is the `loadout.color` failure wearing a
 * `className`, so `tests/modal.test.ts` resolves all three against the theme.
 */
export const MODAL_WIDTH = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-3xl',
} as const;

export type ModalSize = keyof typeof MODAL_WIDTH;

const BOX = cx(
  // NO WIDTH HERE. The width comes from MODAL_WIDTH at the call site, and if a `max-w-*` were
  // left in this list too, both would land on the element and CSS source order — not the prop —
  // would decide which one won. A `size` that silently does nothing is the whole bug.
  'rounded-box border-bw-line bg-base-200 w-full border',
  'inset-shadow-rim shadow-lift',
  // `max-h-full` is the viewport minus the dialog's own padding — but ONLY because the dialog
  // pins its single row to `minmax(0,1fr)`; see DIALOG, where the reason is a measurement rather
  // than an argument. The BOX is what the viewport bounds — see BODY for why that is not the same
  // as clamping the body.
  'flex max-h-full flex-col',
  // The box scales in with the dialog. `group-open:` rather than its own state, so
  // there is exactly one thing (the [open] attribute) driving the animation.
  'scale-95 opacity-0 transition-[opacity,transform] duration-200 ease-strike',
  'group-open:scale-100 group-open:opacity-100',
  'starting:group-open:scale-95 starting:group-open:opacity-0'
);

const DIALOG = cx(
  // `open:grid`, NEVER a bare `grid` — and this is the sharpest trap in the kit.
  //
  // The UA stylesheet closes a dialog with `dialog:not([open]) { display: none }`.
  // A bare `grid` utility sets `display: grid` unconditionally and BEATS it, so
  // every closed modal in the app silently becomes a 1280×900 absolutely-positioned
  // transparent element: it added ~965px of dead scroll to the page and sat there
  // hit-testing clicks, on every route, invisibly. Nothing catches this — it
  // typechecks, it lints, it renders correctly when OPEN, and the app looks fine
  // until you notice the scrollbar. Found by screenshotting the real page.
  //
  // Gating display on [open] hands it back to the platform, which was right.
  'group open:grid',
  'm-auto h-full max-h-none w-full max-w-none place-items-center bg-transparent p-4',
  // ONE DEFINITE ROW, and `minmax(0,1fr)` rather than `1fr`. This is what makes the box's
  // `max-h-full` mean anything at all, and without it the whole flexed-body design silently does
  // nothing: a grid row is auto-sized by default, so `max-height: 100%` on the item resolves
  // against a height the ITEM produced — 100% of itself, which clamps nothing. Measured in a real
  // browser at 1280×800: a tall body gave a 1463px row, a 1463px box hanging 679px off the bottom
  // of the screen, and a body that never scrolled. With the row pinned it is 768px (the viewport
  // less this element's own p-4) and the body scrolls, which is the entire point of the change.
  // `1fr` alone is not enough — a fr track keeps an automatic min-content minimum, the same trap
  // `min-h-0` exists for one layout system across.
  'grid-rows-[minmax(0,1fr)]',
  // display/overlay + allow-discrete is what makes an exit animation possible at
  // all: both properties are discrete, so without this the dialog vanishes on frame
  // one and the transition plays to an empty box nobody sees.
  'transition-[opacity,display,overlay] transition-discrete duration-200 ease-strike',
  'opacity-0 open:opacity-100 starting:open:opacity-0',
  // The room dims and goes out of focus. Not black: base-100 at 70% keeps the
  // indigo, so the modal reads as the lights going down in THIS room rather than a
  // grey sheet dropped over an unrelated one.
  'backdrop:bg-base-100/70 backdrop:backdrop-blur-sm',
  'backdrop:transition-opacity backdrop:duration-200'
);

/**
 * THE BODY FLEXES; IT DOES NOT CLAMP.
 *
 * It used to be `max-h-[60vh]`, which is wrong in both directions at once. On a desktop with room
 * to spare a panel scrolled at 60% of the viewport while the page behind it had none — the
 * complaint that prompted this — and on a short viewport the box could still overflow, because
 * header + 60vh + footer is more than 100vh. Bounding the BOX instead (`max-h-full`) and letting
 * the body take what is left means content scrolls only when the viewport genuinely cannot hold
 * it, and the header and footer stay put either way.
 *
 * `min-h-0` is the load-bearing half of `flex-1`: a flex item's default `min-height: auto` refuses
 * to shrink below its content, so without it the body ignores its own `overflow-y-auto` and pushes
 * the footer off the bottom of the box.
 */
const BODY = 'text-base-content/90 min-h-0 flex-1 overflow-y-auto px-6 pb-5 text-sm';

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // Guarded both ways. showModal() on an already-open dialog throws
    // InvalidStateError, and close() on a closed one fires a spurious `close`
    // event — either turns a harmless double-render into a real bug.
    if (open && !dialog.open) {
      dialog.showModal();
      // The dialog's children are always in the DOM (they must be, to animate out), so React's
      // `autoFocus` fired imperatively at mount — while this dialog was display:none — and did
      // nothing. The native dialog-autofocus algorithm then finds no [autofocus] node and lands on
      // the first tabbable element, which is the × Close button. So focus the first form control
      // ourselves. Dialogs without one (confirm) match nothing and keep the native default.
      dialog.querySelector<HTMLElement>('input, textarea, select')?.focus();
    } else if (!open && dialog.open) dialog.close();

    return () => {
      // Close a still-open dialog on unmount so the browser restores focus to the element that was
      // focused before showModal(). This matters for the confirm host, which remounts the Modal via
      // a `key` change when a request resolves: React tears the open <dialog> out of the DOM, and a
      // dialog removed while open never runs native focus restoration — focus silently drops to
      // <body>, stranding a keyboard/screen-reader user after they confirm. close() restores it.
      if (dialog.open) dialog.close();
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description !== undefined ? descId : undefined}
      className={DIALOG}
      onCancel={(e) => {
        // Esc. preventDefault, then route through onClose like every other
        // dismissal — otherwise the dialog closes itself while `open` is still
        // true, and React, believing it is open, will never reopen it. That is the
        // "the modal won't come back the second time" bug, and it is always this.
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className={cx(BOX, MODAL_WIDTH[size], className)}>
        {/* `shrink-0` on both: with the body at `flex-1` they are the only two items that must
            keep their natural height, and a flex item shrinks by default. */}
        <header className="flex shrink-0 items-start gap-4 px-6 pt-5 pb-4">
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="font-display text-base-content text-lg font-semibold tracking-[0.08em] uppercase"
            >
              {title}
            </h2>
            {description !== undefined && (
              <p id={descId} className="text-bw-muted mt-1 text-sm">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cx(
              'rounded-selector text-bw-muted -m-1 shrink-0 p-1 text-xl leading-none',
              'hover:text-base-content hover:bg-base-300 transition-colors duration-150'
            )}
          >
            {/* A glyph, not an icon dep. Phase 1 has no icon set and inventing one
                here would be a second look decided in the same breath as the first. */}
            ×
          </button>
        </header>

        {children !== undefined && <div className={BODY}>{children}</div>}

        {footer !== undefined && (
          <footer className="border-bw-line flex shrink-0 justify-end gap-2 border-t px-6 py-4">
            {footer}
          </footer>
        )}
      </div>
    </dialog>
  );
}
