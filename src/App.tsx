import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Shell } from '@/shell/Shell';
import { Hub } from '@/shell/pages/Hub';
import { Store } from '@/shell/pages/Store';
import { Leaderboard } from '@/shell/pages/Leaderboard';
import { Profile } from '@/shell/pages/Profile';
import { Play } from '@/shell/pages/Play';
import { NotFound } from '@/shell/pages/NotFound';

/**
 * The router root. Phase 1 and 2 made this file the style guide, with a comment on every
 * commit that the hub, the router and the top bar were Phase 3 and building them here would
 * be four phases of decisions made in one afternoon. This is that afternoon: the style
 * guide is retired (its job — proving the kit could dress a real page — is done), and App
 * is now just the route table. The look it demonstrated now dresses the shell.
 *
 * WHY `BrowserRouter` AND NOT `HashRouter`, on a host with no server-side rewrites. GitHub
 * Pages returns its own 404 for `/Boardwalk/play/blackjack` typed directly, because no such
 * file exists — there is no server to rewrite it to index.html. The fix is not a hash in
 * every URL (which every shared room link in Phase 5 would then carry forever); it is
 * dist/404.html, a byte-for-byte copy of index.html that Pages serves for any unmatched
 * path, which boots the SPA and lets react-router resolve the route client-side. That copy
 * is made and self-checked by the build — see vite.config.ts and scripts/spa-fallback.mjs.
 *
 * `basename` comes from `import.meta.env.BASE_URL` — Vite's `base` (`/Boardwalk/`), with the
 * trailing slash stripped because react-router wants the mount point without it. In dev it
 * is the same value, so links resolve identically to production; hardcoding `/Boardwalk`
 * would be a second home for a fact `vite.config.ts` already owns.
 */
const basename = import.meta.env.BASE_URL.replace(/\/$/, '');

export default function App() {
  return (
    <BrowserRouter basename={basename}>
      <Routes>
        {/* One layout route: <Shell> owns the frame, the gate and the singletons; every
            page below renders into its <Outlet />. */}
        <Route element={<Shell />}>
          <Route index element={<Hub />} />
          <Route path="play/:gameId" element={<Play />} />
          <Route path="store" element={<Store />} />
          <Route path="leaderboard" element={<Leaderboard />} />
          <Route path="profile" element={<Profile />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
