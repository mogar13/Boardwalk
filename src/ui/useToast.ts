import type { ReactNode } from 'react';
import { create } from 'zustand';

/**
 * Toasts. The sanctioned replacement for `alert()`, which is a lint error.
 *
 * WHY A STORE AND NOT A <ToastProvider>. Two reasons, and the second is the real
 * one:
 *
 *   1. A provider has to be ABOVE every caller. Games are lazy-loaded routes, so
 *      "above every caller" means the app root — and then the provider re-renders
 *      the entire tree on every toast, to move a box in the corner.
 *
 *   2. It would be a prop-drilled dependency, and CLAUDE.md's rule is that a game
 *      receives `{ onExit }` and nothing else, because a `system` prop rebuilds the
 *      `window.SystemUI` god-object this project exists to escape. `useToast()` has
 *      to work from any depth with no ceremony, or the first game that needs a
 *      toast from a hook three files down starts passing something around.
 *
 * WHY THIS HOOK CALLS NO HOOKS. It returns a frozen module-level object, so a
 * component that only FIRES toasts never subscribes to the store and never
 * re-renders when the list changes. Only <UiRoot> reads `toasts`. This is the
 * entire point of taking Zustand over Context — the button that raises a toast has
 * no business re-rendering because a toast appeared.
 *
 * It keeps the `use` prefix anyway: it is the API shape callers expect, and it
 * leaves room to subscribe later without changing 40 call sites.
 */
export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  tone: ToastTone;
  message: ReactNode;
}

/** How long each tone stays up, in ms. */
const TTL: Record<ToastTone, number> = {
  info: 4000,
  success: 4000,
  warning: 6000,
  // Errors outlast the rest. You are reading an error because something you did
  // failed; four seconds is not long enough to read it AND decide what to do.
  error: 8000,
};

/**
 * Above this, the oldest is dropped. A loop that fires a toast per iteration is a
 * bug, but the symptom should be "some toasts", not a wall of them covering the
 * game — an unbounded stack turns a small bug into an unusable page.
 */
const MAX_VISIBLE = 4;

interface ToastState {
  toasts: Toast[];
  push: (tone: ToastTone, message: ReactNode) => string;
  dismiss: (id: string) => void;
}

// Module-scope, not in the store: these are side-effect handles, not state. Putting
// a timer id in the store would put it in a snapshot React may compare, and nothing
// downstream ever wants to render one.
const timers = new Map<string, ReturnType<typeof setTimeout>>();

let seq = 0;

const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  push: (tone, message) => {
    const id = `toast-${++seq}`;
    set((s) => {
      const next = [...s.toasts, { id, tone, message }];
      // If the cap drops the oldest toasts, cancel their timers here — otherwise the timer fires
      // later against an id already gone from the list and only then clears itself. The same
      // clearTimeout every other removal (`dismiss`) performs, applied to the ones the cap evicts.
      for (const dropped of next.slice(0, Math.max(0, next.length - MAX_VISIBLE))) {
        const t = timers.get(dropped.id);
        if (t !== undefined) {
          clearTimeout(t);
          timers.delete(dropped.id);
        }
      }
      return { toasts: next.slice(-MAX_VISIBLE) };
    });
    timers.set(
      id,
      setTimeout(() => {
        get().dismiss(id);
      }, TTL[tone])
    );
    return id;
  },

  dismiss: (id) => {
    // Always clear the timer, even when dismissing manually — otherwise it fires
    // later against an id that is gone. Harmless today (a no-op set), and exactly
    // the kind of leak that stops being harmless once the id is reused.
    const t = timers.get(id);
    if (t !== undefined) {
      clearTimeout(t);
      timers.delete(id);
    }
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
  },
}));

/** Read the live list. For <UiRoot> only — everything else fires and forgets. */
export const useToastList = (): Toast[] => useToastStore((s) => s.toasts);

const api = {
  info: (message: ReactNode) => useToastStore.getState().push('info', message),
  success: (message: ReactNode) => useToastStore.getState().push('success', message),
  warning: (message: ReactNode) => useToastStore.getState().push('warning', message),
  error: (message: ReactNode) => useToastStore.getState().push('error', message),
  dismiss: (id: string) => {
    useToastStore.getState().dismiss(id);
  },
} as const;

export type ToastApi = typeof api;

export function useToast(): ToastApi {
  return api;
}
