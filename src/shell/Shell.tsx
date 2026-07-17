import { Outlet } from 'react-router-dom';
import { UiRoot } from '@/ui';
import { useAuthBootstrap } from '@/system/auth/useAuth';
import { AuthGate } from '@/shell/AuthGate';
import { TopBar } from '@/shell/TopBar';

/**
 * The app frame. Mounted once by the router as the layout element wrapping every route, so
 * the two app-root singletons live here and nowhere else:
 *
 *   • `useAuthBootstrap()` — the ONE session subscription, started once, torn down on
 *     unmount. In Phase 2 this sat next to `<UiRoot />` in App.tsx with a comment that both
 *     move into the shell in Phase 3. This is that move.
 *   • `<UiRoot />` — the single host for toasts and `confirm()`. Outside the gate, so a
 *     toast can fire on the sign-in screen too, not only once you are inside.
 *
 * `<AuthGate>` renders the top bar and the routed page only when a player is signed in;
 * before that it is the doorway (or the not-configured panel). The `<Outlet />` is where
 * react-router drops the matched route — the hub, a game, the store.
 */
export function Shell() {
  useAuthBootstrap();

  return (
    <>
      <AuthGate>
        <div className="flex min-h-dvh flex-col">
          <TopBar />
          <main className="mx-auto w-full max-w-[110rem] flex-1 px-4 py-8 sm:px-6 sm:py-12 lg:px-10">
            <Outlet />
          </main>
        </div>
      </AuthGate>

      {/* Always mounted — toasts and confirm() are dead without it, in every auth state. */}
      <UiRoot />
    </>
  );
}
