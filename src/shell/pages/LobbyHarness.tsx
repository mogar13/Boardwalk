import { useNavigate } from 'react-router-dom';
import type { GameManifest } from '@/games/registry';
import { Lobby } from '@/system/room/Lobby';

/**
 * `/_dev/lobby` — DEV ONLY. The verification surface for Phase 5, and nothing more.
 *
 * Multiplayer is built a phase before any game consumes it (games are Phase 6), so the lobby has
 * no real manifest to mount against yet. This page gives it a STUB one so the whole flow — create,
 * claim a seat, fill with AI, chat, start, leave — can be driven in a real browser against the
 * emulator (`VITE_USE_EMULATOR=1`), which is the manual browser check Phase 1 and 3 used to catch
 * the class of bug static guards miss. It is registered in `App.tsx` only when
 * `import.meta.env.DEV`, so it never exists in a production bundle.
 *
 * The stub is a HARNESS FIXTURE, not a registry entry: `registry.ts` stays empty until a real game
 * lands, per the no-game-checklist rule. `_harness` will never resolve through `/play/:gameId`.
 */
const STUB_MANIFEST: GameManifest = {
  id: '_harness',
  name: 'Lobby Harness',
  blurb: 'A stub table for exercising the room, seats and chat before any real game exists.',
  pier: 'tables',
  seats: { min: 2, max: 4 },
  modes: ['online', 'hotseat', 'ai'],
};

export function LobbyHarness() {
  const navigate = useNavigate();
  return (
    <Lobby
      manifest={STUB_MANIFEST}
      onExit={() => {
        void navigate('/');
      }}
    />
  );
}
