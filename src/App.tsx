/**
 * Phase 0 ships an empty page that is LIVE. This is that page, and it is
 * deliberately ugly.
 *
 * The look is decided in Phase 1 (`@boardwalk/theme` + `src/ui`), so anything
 * here that looked designed would be a decision made in the wrong phase — and
 * the one made hardest to reverse, since it would be the thing already on screen.
 * This proves the pipeline (Vite → tsc → lint → guard → Pages), nothing else.
 */
export default function App() {
  return (
    <main>
      <h1>The Boardwalk</h1>
      <p>Phase 0 — the scaffold is live. No games yet; the OS comes first.</p>
    </main>
  );
}
