import type { ReactNode } from 'react';
import { Card } from '@/ui';
import { AuthPanel } from '@/system/auth/AuthPanel';
import { useAuth } from '@/system/auth/useAuth';
import { firebaseReady } from '@/system/repo';
import { Wordmark } from '@/shell/Wordmark';

/**
 * The gate. Nothing inside the boardwalk renders until there is a signed-in player, and
 * this is the one place that decides so — the router mounts it once around the whole app,
 * rather than each page re-deriving "am I allowed here". It resolves four states, in order,
 * and only the last one lets children through:
 *
 *   1. no Firebase config   → the panel that names the missing variables
 *   2. session 'unknown'    → a loading state, NOT a sign-in form (see below)
 *   3. signed out           → the sign-in / sign-up screen
 *   4. signed in            → the app
 *
 * The 'unknown'-is-not-'signed-out' distinction is load-bearing and is authStore's whole
 * reason for a three-valued status: Firebase restores a session a tick after first paint,
 * so rendering the sign-in screen while the answer is still unknown flashes a login form at
 * every returning player on every reload. The honest thing to render until the first answer
 * is "checking".
 */

/**
 * No credentials, no app. The panel names every missing variable.
 *
 * The deliberate opposite of v1's failure mode: there the config was inline in 32 HTML
 * files and a game discovered the database was missing by polling `window.db` every 50ms,
 * forever, silently. Here the answer is on screen, in the theme, naming the fix. A
 * production build never reaches this state — vite.config.ts fails the build — so only
 * `npm run dev` on a fresh clone lands here, which is exactly when someone needs telling.
 */
function NotConfigured({ error }: { error: string }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-6 px-6">
      <Wordmark size="lg" />
      <Card className="flex w-full flex-col gap-3 p-6">
        <h2 className="font-display text-warning text-sm font-semibold tracking-[0.2em] uppercase">
          Firebase is not configured
        </h2>
        <pre className="text-bw-muted overflow-x-auto font-mono text-xs whitespace-pre-wrap">
          {error}
        </pre>
      </Card>
    </div>
  );
}

/** Signed out, or still checking: the boardwalk's front door under the big sign. */
function Doorway({ checking }: { checking: boolean }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-8 px-6 py-16">
      <div className="flex flex-col items-center gap-3 text-center">
        <Wordmark size="lg" />
        <p className="text-bw-muted max-w-sm text-sm">
          A neon arcade built on Casino OS v2. New account, fresh $5,000 — separate from The Game
          Shack.
        </p>
      </div>
      {checking ? (
        <Card className="flex w-full items-center justify-center p-10">
          <p className="text-bw-muted text-sm">Checking your session…</p>
        </Card>
      ) : (
        <div className="w-full">
          <AuthPanel />
        </div>
      )}
    </div>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const ready = firebaseReady();
  const { status } = useAuth();

  if (!ready.ok) return <NotConfigured error={ready.error} />;
  if (status === 'unknown') return <Doorway checking />;
  if (status === 'signed-out') return <Doorway checking={false} />;
  return <>{children}</>;
}
