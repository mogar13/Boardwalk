import type { Profile } from '@boardwalk/game-logic';
import { firebaseProfileRepo } from '@/system/repo/firebase/profileRepo';
import type { EconomyIntent, EconomyOutcome, EconomyRepo, RepoResult } from '@/system/repo/types';

/**
 * THE CLIENT-AUTHORITATIVE FALLBACK — what the economy was through Phase 6, expressed as an
 * `EconomyRepo` so the hooks above it have exactly one shape to call.
 *
 * It ignores the intent entirely and persists `clientNext`: the profile the pure logic
 * (`applyResult`, `applyPurchase`, `claimDaily`) already computed. There is no referee here, and
 * this file does not pretend otherwise — with no `VITE_API_BASE_URL` the player's own device is
 * the source of truth, which is fine for a fresh clone, for the emulator dev loop, and as the
 * kill switch for a Pi outage, and is NOT fine as the deployed default. That is why Phase B
 * exists and why the composition root prefers the HTTP one whenever it can.
 *
 * Keeping this alive is the same call Phase C made about the Firebase room/chat repos: a cutover
 * you cannot reverse in one rebuild is a cutover you have to be brave about at 2am.
 *
 * THE `refill` INTENT IS DEGRADED HERE, AND THE DEGRADATION IS NAMED RATHER THAN HIDDEN. The
 * bankrupt top-up's once-a-day limit is counted off the referee's LEDGER (`refillsToday` in
 * `boardwalk-api`), and there is no ledger on this path — so on the fallback the limit is not
 * enforced, and a player could top up to the floor as often as they go broke. That is not a new
 * hole: this repo persists whatever arithmetic the client computed for a bet, a payout, a purchase
 * and a daily claim already, so an unenforced top-up is strictly less than what a devtools console
 * could do here anyway. What it is NOT is a reason to add a `lastRefillDay` field to the profile:
 * that would be a second, client-writable copy of a fact the ledger already knows, deployed
 * through a rules change, to half-enforce a limit against an attacker who owns the writer.
 */
export const firebaseEconomyRepo: EconomyRepo = {
  async apply(
    uid: string,
    _intent: EconomyIntent,
    clientNext: Profile
  ): Promise<RepoResult<EconomyOutcome>> {
    await firebaseProfileRepo.save(uid, clientNext);
    // The client's own arithmetic IS the authoritative answer in this mode — returning it keeps
    // the caller's "replace local state with what came back" path identical across both repos.
    // `pull: null` is the honest answer for a pack open here: there is no referee to roll one, so
    // the client's own `openPack` result (already baked into `clientNext`) is what happened. The
    // caller reads null as "keep your optimistic pull" rather than "nothing was rolled".
    return { ok: true, value: { profile: clientNext, pull: null } };
  },
};
