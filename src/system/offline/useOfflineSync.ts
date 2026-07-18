import { useEffect } from 'react';
import { useAuthStore } from '@/system/auth/authStore';
import { startOfflineSync, useOfflineStore } from '@/system/offline/offlineStore';

/**
 * Drive offline banking: top the ticket book up while online, and drain the outbox on reconnect.
 *
 * Mounted ONCE, inside the authenticated tree — it needs a uid to bank as and a profile to hand the
 * Firebase fallback. It reads both from the auth store at TICK time rather than at render time, for
 * the same reason `reportResult` does: a flush can fire many renders after the last one, and
 * reconciling against a stale profile is how money goes wrong.
 *
 * The deps are supplied as a GETTER rather than captured, so the effect does not re-subscribe on
 * every profile change — which, with a 30s poller and an `online` listener, would otherwise tear
 * down and rebuild the sync loop on every hand played.
 */
export function useOfflineSync(): void {
  /**
   * Re-run when a session becomes usable, and NOT merely on mount.
   *
   * The shell mounts before anyone is signed in, so a mount-only effect ticks once against a null
   * session, does nothing, and then sleeps until the next poll — leaving a freshly signed-in player
   * with an empty ticket book for up to a full interval. Found by driving the real thing in a
   * browser: sign-up succeeded, the hub rendered, and `POST /tickets` was never called.
   *
   * Keyed on readiness rather than on the profile object, so it fires once when the session lands
   * and does not tear the loop down and rebuild it after every hand played.
   */
  const ready = useAuthStore((s) => s.session !== null && s.profile !== null);

  useEffect(() => {
    if (!ready) return;
    return startOfflineSync(() => {
      const { session, profile, adoptProfile } = useAuthStore.getState();
      if (session === null || profile === null) return null;
      return { uid: session.uid, profile, adopt: adoptProfile };
    });
  }, [ready]);
}

/** What the UI may show: how many results are waiting, and how many more can still be banked. */
export function useOfflineStatus(): { pending: number; remaining: number; enforced: boolean } {
  const state = useOfflineStore((s) => s.state);
  return {
    pending: state.queue.length,
    remaining: state.tickets.length,
    enforced: state.enabled === true,
  };
}
