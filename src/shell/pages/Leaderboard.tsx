import { Placeholder } from '@/shell/pages/Placeholder';

/**
 * The `leaderboard/` node exists and is world-readable already — Phase 2 writes a public
 * projection there on sign-up, and database.rules.json pins it to exactly its four fields.
 * So a live leaderboard is genuinely buildable now. It is held for Phase 4 on purpose: it
 * ranks by `wins`, which is a stat Phase 4 adds with its writer in the same commit, and a
 * leaderboard that can only rank by bankroll would be built to be rebuilt. The reader lands
 * with the field worth reading.
 */
export function Leaderboard() {
  return (
    <Placeholder title="Leaderboard" phase="Phase 4 — economy + progress">
      <p>
        The public standings. The <code className="text-secondary">leaderboard/</code> node is live
        and world-readable today, but it is worth ranking only once Phase 4 adds the wins and stats
        to rank by — so the page that reads it arrives with them, not before.
      </p>
    </Placeholder>
  );
}
