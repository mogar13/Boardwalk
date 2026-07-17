import { useEffect, useState } from 'react';
import { repos } from '@/system/repo';
import type { LeaderboardEntry } from '@/system/repo';

/**
 * `useLeaderboard()` — a one-shot read of the public standings, for the leaderboard page.
 *
 * It reads through `repos.leaderboard`, which reads `leaderboard/` — a world-readable node — so
 * this works signed out. A one-shot `get` on mount, not a live subscription: standings do not
 * need to tick in real time the way a bankroll does, and a live listener here would be a listener
 * to leak, which is the v1 defect the whole repo boundary is shaped to avoid. If live standings
 * ever matter, that is a change behind `LeaderboardRepo`, not here.
 *
 * `alive` guards the async: a fast unmount (navigate away before the read returns) must not set
 * state on a gone component. `error` is a boolean, not a message — a failed standings read is
 * "couldn't load, retry", not a Firebase code to put in front of a player.
 */
export interface LeaderboardState {
  readonly loading: boolean;
  readonly entries: readonly LeaderboardEntry[];
  readonly error: boolean;
}

export function useLeaderboard(limit = 25): LeaderboardState {
  const [state, setState] = useState<LeaderboardState>({
    loading: true,
    entries: [],
    error: false,
  });

  useEffect(() => {
    // No synchronous setState here — the state already starts `loading`, and resetting it in the
    // effect body is the cascading-render the react-hooks lint rightly flags. The two async
    // callbacks below settle it. `limit` is effectively constant (the page passes 25), so there is
    // no stale-entries-during-reload case to reset for; if a caller ever varies it, a keyed remount
    // is the honest fix, not a sync setState.
    let alive = true;
    repos.leaderboard.top(limit).then(
      (entries) => {
        if (alive) setState({ loading: false, entries, error: false });
      },
      () => {
        if (alive) setState({ loading: false, entries: [], error: true });
      }
    );
    return () => {
      alive = false;
    };
  }, [limit]);

  return state;
}
