import type { ReactNode } from 'react';
import { create } from 'zustand';

/**
 * `confirm()` — the promise-based one, built on <Modal>.
 *
 * WHY THIS EXISTS AT ALL, when CLAUDE.md's lint message already says "use <Modal>".
 * Because a ban is only as strong as its alternative. `if (confirm(msg))` is one
 * line; the declarative equivalent is a `useState`, an `open` prop, two callbacks
 * and a footer — and asking for twenty lines where the platform offers one is how a
 * rule gets worked around instead of followed. This restores the one-liner:
 *
 *   if (await confirm({ title: 'Leave the table?', confirmLabel: 'Forfeit $250' })) …
 *
 * The lint rule bans the global; this is what makes obeying it cheaper than not.
 * <Modal> stays the primitive for anything with a form in it.
 *
 * WHY `confirmLabel` CANNOT BE "OK". This is the "fix by type, not by convention"
 * rule reaching somewhere conventions never do. CLAUDE.md asks callers to "name what
 * it destroys ('Leave the table — your $250 bet is forfeit?'), never 'Are you
 * sure?'" — and that is prose, so it would be obeyed for a month. `ActionLabel`
 * below makes the vague labels literally not typecheck: a button that says OK next
 * to a question you did not read is the reason people click through destructive
 * dialogs, and the fix is a button that says what it does.
 */

/** Labels that describe the button instead of the consequence. */
type VagueLabel =
  'ok' | 'yes' | 'no' | 'confirm' | 'sure' | 'continue' | 'submit' | 'done' | 'accept' | 'proceed';

/**
 * `never` for a vague label, so the property fails to typecheck at the call site.
 * Lowercase<> so 'OK', 'Ok' and 'ok' are all caught — the check is about the word,
 * not the casing.
 */
export type ActionLabel<S extends string> = Lowercase<S> extends VagueLabel ? never : S;

interface ConfirmBase {
  /** The question. Name the thing at stake: "Leave the table?" */
  title: string;
  /** The consequence, spelled out: "Your $250 bet is forfeit." */
  body?: ReactNode;
  /** Defaults to "Cancel" — the safe path is allowed to be boring. */
  cancelLabel?: string;
  /** Paints the action red. For anything that loses money or data. */
  destructive?: boolean;
}

export interface ConfirmRequest extends ConfirmBase {
  confirmLabel: string;
}

interface Pending extends ConfirmRequest {
  id: number;
  resolve: (ok: boolean) => void;
}

interface ConfirmState {
  pending: Pending | null;
  /** How many <UiRoot>s are mounted. See `ask` for why this is tracked. */
  hosts: number;
}

let seq = 0;

const useConfirmStore = create<ConfirmState>(() => ({ pending: null, hosts: 0 }));

/** For <UiRoot> only. */
export const usePendingConfirm = (): Pending | null => useConfirmStore((s) => s.pending);

export function registerConfirmHost(): () => void {
  useConfirmStore.setState((s) => ({ hosts: s.hosts + 1 }));
  return () => {
    useConfirmStore.setState((s) => ({ hosts: s.hosts - 1 }));
  };
}

function settle(ok: boolean): void {
  const { pending } = useConfirmStore.getState();
  if (!pending) return;
  useConfirmStore.setState({ pending: null });
  pending.resolve(ok);
}

export const resolveConfirm = settle;

function ask(req: ConfirmRequest): Promise<boolean> {
  const { hosts, pending } = useConfirmStore.getState();

  // No host, no dialog — and an unresolved promise here would hang the caller
  // FOREVER with no error and nothing on screen. A forgotten <UiRoot> has to fail
  // loudly and safely, and "safely" means false: never take the destructive branch
  // for a question the user was never shown.
  if (hosts === 0) {
    console.error(
      '[boardwalk/ui] confirm() called with no <UiRoot> mounted — answering "no". Mount <UiRoot /> once at the app root.'
    );
    return Promise.resolve(false);
  }

  // One at a time. A second dialog cannot be seen behind the first, so queueing
  // would strand its promise; answering `false` is the same contract as dismissing
  // it, which is what a user who cannot see it would have done.
  if (pending) {
    console.error('[boardwalk/ui] confirm() called while another was open — answering "no".');
    return Promise.resolve(false);
  }

  return new Promise<boolean>((resolve) => {
    useConfirmStore.setState({ pending: { ...req, id: ++seq, resolve } });
  });
}

/**
 * Overloaded so the generic exists only to capture the literal. `const L` gives us
 * 'Forfeit $250' rather than `string`, and `L & ActionLabel<L>` collapses to `never`
 * for a vague label — which surfaces as an error ON `confirmLabel`, at the call
 * site, rather than somewhere downstream.
 */
const confirmApi = {
  confirm: <const L extends string>(req: ConfirmBase & { confirmLabel: L & ActionLabel<L> }) =>
    ask(req),
} as const;

export type ConfirmApi = typeof confirmApi;

export function useConfirm(): ConfirmApi {
  return confirmApi;
}
