import { apiFetch, type ApiClientConfig } from '@/system/repo/api/client';
import type { TicketBatch, TicketRepo } from '@/system/repo/types';

/**
 * `POST /tickets` — ask the referee for signed nonces.
 *
 * The one thing worth reading here is what happens when the answer is not a clean grant, because
 * this is the only repo whose failure has to be SILENT and non-blocking. Every other repo call
 * backs a thing the player just did, so a failure is a toast; this one runs in the background to
 * keep an offline budget topped up, and a player who is merely online has no idea it exists.
 *
 * So both failure paths degrade to `enabled: false, tickets: []`:
 *
 *   • A network failure means we could not ask. The client keeps whatever tickets it holds and
 *     tries again later — which is exactly right, because being unable to reach the server is the
 *     condition the ticket book exists for.
 *   • A non-OK status means the same in practice, and there is no useful distinction to draw for a
 *     background top-up.
 *
 * Note it does NOT set `enabled` to false in the store on a failure — the caller merges, and only a
 * successful answer carrying `enabled: false` is treated as "this server does not enforce". A
 * failed request must never be read as permission to mint your own nonces.
 */
export function httpTicketRepo(cfg: ApiClientConfig): TicketRepo {
  return {
    async issue(deviceId, want) {
      const empty: TicketBatch = { enabled: false, tickets: [], outstanding: 0 };
      let res: Response;
      try {
        res = await apiFetch(cfg, '/tickets', {
          method: 'POST',
          body: JSON.stringify({ deviceId, want }),
        });
      } catch {
        return empty;
      }
      if (!res.ok) return empty;

      const body = (await res.json().catch(() => ({}))) as Partial<TicketBatch>;
      return {
        enabled: body.enabled === true,
        tickets: Array.isArray(body.tickets)
          ? body.tickets.filter((t): t is string => typeof t === 'string')
          : [],
        outstanding: typeof body.outstanding === 'number' ? body.outstanding : 0,
      };
    },
  };
}

/**
 * The no-referee twin: a fresh clone, the emulator, or `VITE_API_ECONOMY=0`.
 *
 * `enabled: false` is the truthful answer there and not a stub — on those paths the economy is the
 * client-authoritative one it was through Phase 6, so there is no referee to sign anything and no
 * bound to enforce. A client-minted nonce is the correct behaviour, exactly as before this feature
 * existed.
 */
export const localTicketRepo: TicketRepo = {
  issue: () => Promise.resolve({ enabled: false, tickets: [], outstanding: 0 }),
};
