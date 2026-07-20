import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '@boardwalk/game-logic';
import type { EconomyIntent, RepoResult, EconomyOutcome, TicketBatch } from '@/system/repo/types';

/**
 * The EFFECTFUL half of offline banking — the flush loop's invariants.
 *
 * The rules are next door in `offline-queue.test.ts` (pure) and the wire is guarded server-side in
 * `boardwalk-api/tests/tickets.test.ts` (where the replay attack is demonstrated). What is left,
 * and what this file covers, is the handful of orchestration decisions that no pure function sees:
 * drain order, stop-on-failure, adopt-only-when-empty, and the two `enabled` transitions that would
 * silently switch the client back to minting its own nonces if they were inverted.
 */

const apply =
  vi.fn<
    (uid: string, intent: EconomyIntent, next: Profile) => Promise<RepoResult<EconomyOutcome>>
  >();
const issue = vi.fn<(deviceId: string, want: number) => Promise<TicketBatch>>();

vi.mock('@/system/repo', () => ({
  repos: {
    economy: { apply: (...a: unknown[]) => apply(...(a as Parameters<typeof apply>)) },
    tickets: { issue: (...a: unknown[]) => issue(...(a as Parameters<typeof issue>)) },
  },
}));

/**
 * A minimal `localStorage`, because the suite runs in node and this project has no jsdom. Stubbed
 * rather than adding a DOM environment: the store's storage contract is four calls wide, and
 * pulling in jsdom to satisfy it would slow every other test file in the repo for one.
 *
 * Installed BEFORE the dynamic import below — `offlineStore` reads persisted state at module load.
 */
const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => {
      store.clear();
    },
  },
});

const { useOfflineStore } = await import('@/system/offline/offlineStore');
const { emptyOffline, enqueue } = await import('@/system/offline/queue');
type OfflineState = import('@/system/offline/queue').OfflineState;

const profile = { name: 'Ada' } as unknown as Profile;
const served = (p: Profile = profile): RepoResult<EconomyOutcome> => ({
  ok: true,
  value: { profile: p, pull: null },
});

const settle = (nonce: string): EconomyIntent => ({
  kind: 'settle',
  nonce,
  gameId: 'chess',
  outcome: 'win',
  payoutCents: 0,
});

const seed = (nonces: string[], tickets: string[] = []): void => {
  let state: OfflineState = { ...emptyOffline('d-test'), enabled: true, tickets };
  for (const n of nonces) state = enqueue(state, { intent: settle(n) as never, stampedAt: 1 });
  useOfflineStore.setState({ state });
};

const deps = (adopt = vi.fn()) => ({ uid: 'u1', profile, adopt });

beforeEach(() => {
  apply.mockReset();
  issue.mockReset();
  localStorage.clear();
  useOfflineStore.setState({ state: emptyOffline('d-test') });
});

describe('the flush loop', () => {
  it('drains in the order results were banked', async () => {
    seed(['a', 'b', 'c']);
    apply.mockResolvedValue(served());
    await useOfflineStore.getState().flush(deps());
    expect(apply.mock.calls.map((c) => c[1].nonce)).toEqual(['a', 'b', 'c']);
    expect(useOfflineStore.getState().state.queue).toEqual([]);
  });

  it('STOPS at the first network failure and keeps the rest, in order', async () => {
    seed(['a', 'b', 'c']);
    apply.mockResolvedValueOnce(served()).mockRejectedValueOnce(new Error('offline'));
    await useOfflineStore.getState().flush(deps());
    // 'b' threw: it must still be queued, and 'c' must NOT have been attempted — burning the whole
    // queue against a dead connection is how a reconnect loses everything at once.
    expect(apply).toHaveBeenCalledTimes(2);
    expect(useOfflineStore.getState().state.queue.map((e) => e.intent.nonce)).toEqual(['b', 'c']);
  });

  it('re-sending after a partial flush replays the SAME nonces, never fresh ones', async () => {
    seed(['a', 'b']);
    apply.mockResolvedValueOnce(served()).mockRejectedValueOnce(new Error('offline'));
    await useOfflineStore.getState().flush(deps());

    apply.mockReset();
    apply.mockResolvedValue(served());
    await useOfflineStore.getState().flush(deps());
    // The whole point of persisting the intent verbatim: the server's idempotency only engages if
    // the retry carries the ORIGINAL nonce. A fresh one would bank the result a second time.
    expect(apply.mock.calls.map((c) => c[1].nonce)).toEqual(['b']);
  });

  it('adopts the authoritative profile ONLY once the queue is empty', async () => {
    seed(['a', 'b']);
    const adopt = vi.fn();
    apply.mockResolvedValue(served());
    await useOfflineStore.getState().flush(deps(adopt));
    // Adopting after 'a' would install a profile that knows nothing of 'b' and visibly roll back
    // XP the player has already been shown.
    expect(adopt).toHaveBeenCalledTimes(1);
  });

  it('does not adopt at all when the drain never completes', async () => {
    seed(['a', 'b']);
    const adopt = vi.fn();
    apply.mockResolvedValueOnce(served()).mockRejectedValueOnce(new Error('offline'));
    await useOfflineStore.getState().flush(deps(adopt));
    expect(adopt).not.toHaveBeenCalled();
  });

  it('drops an entry the server genuinely refuses rather than wedging the queue', async () => {
    seed(['a', 'b']);
    apply
      .mockResolvedValueOnce({ ok: false, error: 'payout with no open wager' })
      .mockResolvedValue(served());
    await useOfflineStore.getState().flush(deps());
    expect(useOfflineStore.getState().state.queue).toEqual([]);
  });

  it('does NOT re-stamp a genuine refusal, even with spares in the book', async () => {
    // The seed matters: with an EMPTY ticket book a re-stamp fails for want of a ticket and the
    // entry gets dropped anyway, so the test passes for the wrong reason and a "re-stamp on any
    // refusal" bug sails through. This version was written after exactly that falsification gap —
    // spares present, so re-stamping is possible and must still not happen.
    seed(['a'], ['spare-1', 'spare-2']);
    apply.mockResolvedValue({ ok: false, error: 'payout with no open wager' });
    await useOfflineStore.getState().flush(deps());

    // One attempt, entry dropped, and — the part that catches the bug — no ticket burned. Retrying
    // a refusal the server will give again forever is how a queue wedges AND drains the budget.
    expect(apply).toHaveBeenCalledTimes(1);
    expect(useOfflineStore.getState().state.queue).toEqual([]);
    expect(useOfflineStore.getState().state.tickets).toEqual(['spare-1', 'spare-2']);
  });

  it('RE-STAMPS a retired ticket and re-sends, spending exactly one spare', async () => {
    seed(['old'], ['spare-1', 'spare-2']);
    apply
      .mockResolvedValueOnce({
        ok: false,
        error: 'this ticket was signed with a key that is no longer in use',
      })
      .mockResolvedValue(served());
    await useOfflineStore.getState().flush(deps());

    expect(apply.mock.calls.map((c) => c[1].nonce)).toEqual(['old', 'spare-1']);
    expect(useOfflineStore.getState().state.queue).toEqual([]);
    expect(useOfflineStore.getState().state.tickets).toEqual(['spare-2']);
  });

  it('drops a retired entry when there is no spare, rather than retrying forever', async () => {
    seed(['old'], []);
    apply.mockResolvedValue({
      ok: false,
      error: 'this ticket was signed with a key that is no longer in use',
    });
    await useOfflineStore.getState().flush(deps());
    expect(apply).toHaveBeenCalledTimes(1);
    expect(useOfflineStore.getState().state.queue).toEqual([]);
  });

  it('does not run two drains at once', async () => {
    seed(['a', 'b']);
    apply.mockImplementation(
      () =>
        new Promise((r) =>
          setTimeout(() => {
            r(served());
          }, 5)
        )
    );
    await Promise.all([
      useOfflineStore.getState().flush(deps()),
      useOfflineStore.getState().flush(deps()),
    ]);
    // Two concurrent drains would race the same head entry into a double send — which the server
    // would collapse on the nonce, but which would also double-count the spend locally.
    expect(apply.mock.calls.map((c) => c[1].nonce)).toEqual(['a', 'b']);
  });
});

describe('acquiring a nonce', () => {
  it('tops up on the FIRST settle rather than falling through to a self-minted nonce', async () => {
    // The race that would otherwise lose a player's first result of the session: a fresh device
    // has no tickets and does not yet know whether the server enforces.
    issue.mockResolvedValue({ enabled: true, tickets: ['t-1', 't-2'], outstanding: 2 });
    const got = await useOfflineStore.getState().acquireNonce();
    expect(issue).toHaveBeenCalledTimes(1);
    expect(got).toEqual({ ticket: 't-1', required: true });
  });

  it('reports not-required on a server that does not enforce, so the caller mints as before', async () => {
    issue.mockResolvedValue({ enabled: false, tickets: [], outstanding: 0 });
    expect(await useOfflineStore.getState().acquireNonce()).toEqual({
      ticket: null,
      required: false,
    });
    // …and having learned that, it stops asking.
    await useOfflineStore.getState().acquireNonce();
    expect(issue).toHaveBeenCalledTimes(1);
  });

  it('reports EXHAUSTED — not "mint your own" — when a server that enforces cannot be reached', async () => {
    useOfflineStore.setState({ state: { ...emptyOffline('d'), enabled: true, tickets: [] } });
    // `httpTicketRepo` degrades a network failure to `enabled: false`; if that were taken at face
    // value the client would silently switch back to minting its own nonces on a flaky connection,
    // which is the bound quietly turning itself off. It must stay `required`.
    issue.mockResolvedValue({ enabled: false, tickets: [], outstanding: 0 });
    expect(await useOfflineStore.getState().acquireNonce()).toEqual({
      ticket: null,
      required: true,
    });
    expect(useOfflineStore.getState().state.enabled).toBe(true);
  });

  it('spends without a round trip when the book is stocked', async () => {
    useOfflineStore.setState({ state: { ...emptyOffline('d'), enabled: true, tickets: ['t-9'] } });
    expect(await useOfflineStore.getState().acquireNonce()).toEqual({
      ticket: 't-9',
      required: true,
    });
    expect(issue).not.toHaveBeenCalled();
  });
});

describe('persistence', () => {
  it('survives a reload — a banked result is still there', async () => {
    seed(['a'], ['t-1']);
    // `bank` writes through to storage; re-parsing is what a fresh page load does.
    useOfflineStore.getState().bank(settle('b') as never, 99);
    const raw = localStorage.getItem('boardwalk.offline.v1');
    expect(raw).not.toBeNull();
    const { parseOffline } = await import('@/system/offline/queue');
    expect(parseOffline(raw, 'fresh').queue.map((e) => e.intent.nonce)).toEqual(['a', 'b']);
  });
});
