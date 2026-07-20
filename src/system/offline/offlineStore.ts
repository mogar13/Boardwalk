import { create } from 'zustand';
import { repos } from '@/system/repo';
import type { Profile } from '@boardwalk/game-logic';
import type { RepoResult, EconomyOutcome } from '@/system/repo/types';
import {
  OFFLINE_STORAGE_KEY,
  addTickets,
  emptyOffline,
  enqueue,
  needsTopUp,
  parseOffline,
  resolve,
  restamp,
  serializeOffline,
  takeTicket,
  topUpWant,
  type OfflineState,
  type SettleIntent,
} from '@/system/offline/queue';

/**
 * OFFLINE BANKING — the effectful half. Storage, the top-up, and the flush loop.
 *
 * The rules live next door in `queue.ts` and are pure and unit-tested; this file is the part that
 * touches `localStorage`, `navigator.onLine` and the network, and it is deliberately thin. Same
 * split as `audioStore`/`engine` and for the same reason: the interesting decisions should be
 * testable without a browser.
 *
 * WHAT IT GUARANTEES, and each one is a line of code you can point at:
 *
 *   • A result is banked with a ticket already spent, or it is not banked at all. There is no path
 *     that queues without a ticket, because `takeTicket` returns `null` rather than inventing one.
 *   • The flush is SEQUENTIAL and stops at the first failure, so a queue drains in the order it was
 *     banked and a dead connection does not burn the whole queue against it.
 *   • The authoritative profile is adopted only once the queue is EMPTY. Adopting mid-drain would
 *     roll back the optimistic XP of results still waiting — the server's answer to entry 1 knows
 *     nothing about entry 2.
 */

const DEVICE_ID_BYTES = 8;

/** A device id: `[A-Za-z0-9_-]{8,64}` per the server's own check, so it can never contain a dot. */
function freshDeviceId(): string {
  const bytes = new Uint8Array(DEVICE_ID_BYTES);
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return `d-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Storage that cannot take the app down. Safari's private mode throws on `setItem` once the quota
 * is reached, and a throw on the banking path would lose the very result it was called to keep — so
 * a persistence failure degrades to in-memory only, which still flushes fine for this session.
 */
const read = (): string | null => {
  try {
    return localStorage.getItem(OFFLINE_STORAGE_KEY);
  } catch {
    return null;
  }
};
const write = (state: OfflineState): void => {
  try {
    localStorage.setItem(OFFLINE_STORAGE_KEY, serializeOffline(state));
  } catch {
    /* in-memory only — see above */
  }
};

/**
 * What a flush needs from the signed-in world, passed IN rather than reached for.
 *
 * `authStore` calls into offline banking (a settle spends a ticket), so offline banking naming
 * `authStore` back would be an import cycle — and the lazy-import dodge that hides one is how a
 * module ends up initialising in an order nobody can predict. Inverting it costs one interface and
 * makes the flush trivially testable besides: there is no store to stand up, only an object.
 */
export interface FlushDeps {
  readonly uid: string;
  /** Fed only to the Firebase fallback's `clientNext`; the referee ignores it, which is the point. */
  readonly profile: Profile;
  /** Install the authoritative profile. Called at most once per drain, when the queue empties. */
  readonly adopt: (profile: Profile) => void;
}

interface OfflineStore {
  readonly state: OfflineState;
  /**
   * Spend a ticket for a settle, or `null` if the budget is gone. `null` from a server that
   * enforces means the result CANNOT be banked and the caller must say so; `null` from a server
   * that does not enforce is normal and the caller mints its own nonce as before.
   */
  readonly takeNonce: () => string | null;
  /**
   * The nonce a settle should carry, topping up first if the book is empty and the server's stance
   * is still unknown or known-required.
   *
   * THE RACE THIS CLOSES. `takeNonce` alone is wrong for the FIRST settle of a session: a fresh
   * device has no tickets and `enabled` is `null`, so it would fall through to a self-minted nonce
   * and eat a 409 from a server that enforces — losing a result the player just earned. The sync
   * loop tops up on mount, which makes the window small, and small is not closed. Awaiting a
   * top-up here closes it: `reportResult` is already fire-and-forget, so there is nothing to block.
   *
   * Returns `{ ticket: null, required: false }` on a server that does not enforce, which is the
   * ordinary Firebase/emulator path and means "mint your own, as always".
   */
  readonly acquireNonce: () => Promise<{ ticket: string | null; required: boolean }>;
  /** Does this server require tickets? `null` until the first answer. */
  readonly required: () => boolean | null;
  readonly bank: (intent: SettleIntent, now: number) => void;
  readonly topUp: () => Promise<void>;
  readonly flush: (deps: FlushDeps) => Promise<void>;
  readonly pending: () => number;
  readonly remaining: () => number;
}

const persisted = parseOffline(read(), freshDeviceId());

export const useOfflineStore = create<OfflineStore>((set, get) => {
  const put = (next: OfflineState): void => {
    write(next);
    set({ state: next });
  };

  /** One flush at a time. Two concurrent drains would race the same entry into a double send. */
  let flushing = false;

  return {
    state: persisted,

    required: () => get().state.enabled,
    pending: () => get().state.queue.length,
    remaining: () => get().state.tickets.length,

    takeNonce: () => {
      const taken = takeTicket(get().state);
      if (taken === null) return null;
      put(taken.state);
      return taken.ticket;
    },

    acquireNonce: async () => {
      const immediate = get().takeNonce();
      if (immediate !== null) return { ticket: immediate, required: true };

      // Empty. If the server has already told us it does not enforce, mint as before.
      if (get().state.enabled === false) return { ticket: null, required: false };

      // Unknown, or known-required and exhausted. Ask once — this is also the first-settle path,
      // where the answer establishes `enabled` for the rest of the session.
      await get().topUp();
      const afterTopUp = get().takeNonce();
      return { ticket: afterTopUp, required: get().state.enabled === true };
    },

    bank: (intent, now) => {
      put(enqueue(get().state, { intent, stampedAt: now }));
    },

    topUp: async () => {
      const before = get().state;
      if (!needsTopUp(before)) return;
      const batch = await repos.tickets.issue(before.deviceId, topUpWant(before));
      // A FAILED request must never be read as "not required" — `httpTicketRepo` returns
      // `enabled: false` on a network error too, so only a grant or an explicit empty-but-enabled
      // answer may move `enabled` off `null`. Getting this backwards would let one flaky request
      // permanently switch the client back to minting its own nonces.
      if (batch.tickets.length === 0 && !batch.enabled && before.enabled !== null) return;
      const after = get().state;
      put({
        ...addTickets(after, batch.tickets),
        enabled: batch.enabled || batch.tickets.length > 0,
      });
    },

    flush: async (deps: FlushDeps) => {
      if (flushing) return;
      flushing = true;
      try {
        // Re-read each iteration: a game may bank another result while this drains.
        for (;;) {
          const entry = get().state.queue[0];
          if (entry === undefined) break;

          let result: RepoResult<EconomyOutcome>;
          try {
            result = await repos.economy.apply(deps.uid, entry.intent, deps.profile);
          } catch {
            return; // Still offline. Keep the queue, keep the order, try again later.
          }

          if (!result.ok) {
            // A RETIRED ticket is the one refusal that is the server's fault, and the only one a
            // re-stamp is sound for: the gate refuses before the mutation's transaction opens, so
            // the old ticket is provably unspent. Everything else — a genuine refusal, an invalid
            // ticket — drops the entry, because retrying it forever would wedge the queue.
            const stamped = isRetired(result.error)
              ? restamp(get().state, entry.intent.nonce)
              : null;
            if (stamped !== null) {
              put(stamped.state);
              continue;
            }
            put(resolve(get().state, entry.intent.nonce));
            continue;
          }

          const drained = resolve(get().state, entry.intent.nonce);
          put(drained);
          if (drained.queue.length === 0) {
            // ADOPT ONLY WHEN EMPTY. Mid-drain, the server's answer reflects the entries it has
            // seen and none of the ones still queued, so installing it would visibly roll back XP
            // the player has already been shown for a result that is still on its way.
            deps.adopt(result.value.profile);
          }
        }
      } finally {
        flushing = false;
      }
    },
  };
});

/** The server's word for it, matched loosely — the client only needs the one bit. */
const isRetired = (error: string): boolean => error.includes('no longer in use');

/**
 * Wire the browser's own signals. Driven by `useOfflineSync()`, which supplies the signed-in deps.
 *
 * `online` is the event that matters and a slow poller backs it up, because `navigator.onLine` is
 * famously optimistic: it reports "online" for a captive portal and for a tunnel that is up but
 * unreachable. The poller is what actually recovers those, and it is cheap because `flush` returns
 * immediately on an empty queue.
 */
export function startOfflineSync(deps: () => FlushDeps | null, intervalMs = 30_000): () => void {
  const tick = (): void => {
    const d = deps();
    if (d === null) return; // Signed out: nothing to top up for and nobody to bank as.
    void useOfflineStore.getState().topUp();
    void useOfflineStore.getState().flush(d);
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  window.addEventListener('online', tick);
  return () => {
    clearInterval(timer);
    window.removeEventListener('online', tick);
  };
}

export { emptyOffline };
