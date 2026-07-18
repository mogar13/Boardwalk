import { useEffect, useState } from 'react';
import type { BoardId } from '@/system/progress/boards';
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

export function useLeaderboard(board: BoardId = 'wins', limit = 25): LeaderboardState {
  const [state, setState] = useState<LeaderboardState>({
    loading: true,
    entries: [],
    error: false,
  });

  useEffect(() => {
    // No synchronous setState here — the state already starts `loading`, and resetting it in the
    // effect body is the cascading-render the react-hooks lint rightly flags. The two async
    // callbacks below settle it. `board` DOES vary (the page's tabs), so `alive` also guards
    // against an out-of-order settle: switch tabs fast and an earlier board's read must not land
    // over a later one — the cleanup flips `alive` before the next effect runs, so a stale
    // response is dropped. That leaves the previous board's rows on screen for a blink during the
    // switch, which reads as "loading the new board", not a flash of empty.
    let alive = true;
    repos.leaderboard.top(limit, board).then(
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
  }, [board, limit]);

  return state;
}
