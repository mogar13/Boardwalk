import { useCallback, useEffect, useState } from 'react';
import { repoWiring } from '@/system/repo';

/**
 * A live read of the referee's `/health`, for the `/dev` readout.
 *
 * WHY THIS IS NOT IN `src/system/repo`. `/health` is not a repo operation — it is unauthenticated,
 * it answers about the SERVER rather than about any player's data, and nothing in the app makes a
 * decision from it. Putting it behind `Repos` would add a method to an interface that both
 * implementations would have to answer, and the Firebase one has no server to ask.
 *
 * IT USES `fetch` DIRECTLY, and that is the one place in `src/` outside the repo layer that talks
 * to the API. Deliberate: `apiFetch` attaches a bearer token, and a health probe that needs a
 * signed-in session cannot tell "the Pi is down" from "my token expired" — which is precisely the
 * question this exists to answer. No token, no ambiguity.
 *
 * WHAT `/health` CANNOT TELL YOU, stated here because this repo has been wrong about it before and
 * the memory of it is a whole CLAUDE.md row: **`/health` is not deploy evidence.** It answers
 * identically under Phase A and Phase B, and it answered `ok` for three days while a line in
 * CLAUDE.md claimed something the artifact did not support. It says the process is up and the
 * database opens. It says NOTHING about which commit is running. The `/dev` page words it that way
 * on purpose.
 */
export interface ApiHealth {
  readonly ok: boolean;
  readonly db: string;
  /** `'on'` when TICKET_SECRET is set — the offline-banking gate is enforcing. */
  readonly tickets: string;
}

export type HealthState =
  /** No API composed in this build. `url` is non-null when one is CONFIGURED but not in use. */
  | { readonly status: 'unconfigured'; readonly url: string | null }
  | { readonly status: 'loading' }
  | { readonly status: 'up'; readonly health: ApiHealth; readonly latencyMs: number }
  | { readonly status: 'down'; readonly reason: string };

export interface HealthProbe {
  readonly state: HealthState;
  /** Re-probe on demand — the readout has a button, because "is it back yet" is the usual question. */
  readonly refresh: () => void;
}

export function useApiHealth(): HealthProbe {
  /**
   * PROBE WHAT THIS BUILD ACTUALLY COMPOSED, not merely what is configured. The two differ in a
   * real and common case: an emulator dev run carries a `VITE_API_BASE_URL` in `.env.local` while
   * `repoWiring` deliberately composes the Firebase path (a `demo-boardwalk` token is one the live
   * Pi's verifier rejects). Probing the URL anyway produced a guaranteed CORS failure in the
   * console and a red "unreachable" on a page whose entire job is being trustworthy — reporting a
   * server as down because this build was never going to call it is exactly the confidently-wrong
   * claim the page exists to stop. So the probe follows `apiConfigured`, and the readout still
   * SHOWS the configured URL, labelled as not in use.
   */
  const base = repoWiring.apiConfigured ? repoWiring.apiBaseUrl : null;
  const [state, setState] = useState<HealthState>(
    base === null ? { status: 'unconfigured', url: repoWiring.apiBaseUrl } : { status: 'loading' }
  );
  const [nonce, setNonce] = useState(0);

  // Setting state HERE is fine — this is an event handler, not an effect body. Both of this
  // hook's synchronous `setState`s used to sit inside the effect, which `react-hooks` rightly
  // flags as a cascading render; the cure is the same one `useLeaderboard` documents. The
  // `unconfigured`/`loading` split is already decided by the initial state above (it is a
  // build-time constant and cannot change under us), and "probing again" is a user action.
  const refresh = useCallback(() => {
    if (base === null) return;
    setState({ status: 'loading' });
    setNonce((n) => n + 1);
  }, [base]);

  useEffect(() => {
    if (base === null) return;
    // `alive` guards a settle after unmount, and also an out-of-order settle when the button is
    // pressed twice — the same pattern `useLeaderboard` uses and for the same two reasons.
    let alive = true;

    // A timeout, because a Pi that is powered off does not refuse a connection — it hangs, and a
    // readout stuck on "loading" forever reads as a broken page rather than as a down server.
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, 8000);
    const started = performance.now();

    fetch(`${base}/health`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
        return (await res.json()) as ApiHealth;
      })
      .then(
        (health) => {
          if (alive) {
            setState({ status: 'up', health, latencyMs: Math.round(performance.now() - started) });
          }
        },
        (err: unknown) => {
          if (!alive) return;
          // The message is shown to a developer looking at their own backend, so it carries the
          // real reason rather than the "couldn't load, retry" a player would get.
          const reason =
            err instanceof DOMException && err.name === 'AbortError'
              ? 'timed out after 8s'
              : err instanceof Error
                ? err.message
                : 'unreachable';
          setState({ status: 'down', reason });
        }
      );

    return () => {
      alive = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [base, nonce]);

  return { state, refresh };
}
