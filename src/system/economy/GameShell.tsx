import { useCallback, useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { GameManifest } from '@/games/registry';
import { GameContextProvider } from '@/system/economy/gameContext';
import { NO_OPTIONS, setOptionValue } from '@/system/options/options';
import { readOptionValues, writeOptionValues } from '@/system/options/optionParams';

/**
 * `<GameShell>` — the boundary the play route wraps a game in, so `useGame`/`useBet` have a
 * manifest to read. ARCHITECTURE.md: "`<GameShell>` provides the context and owns the top bar
 * and modals — v1's HUD, but injected once by the shell instead of by each of 31 games calling
 * `SystemUI.init()`."
 *
 * IN PHASE 4 IT DOES THE CONTEXT AND ONLY THE CONTEXT. The top bar is already owned by
 * `src/shell` for every route, a game route included, so there is nothing to re-own here; and
 * the modals are `<UiRoot>`, mounted once at the app root. Widening this to grab those now would
 * be rebuilding chrome that already exists. It provides the economy's context — the manifest —
 * which is the piece Phase 4's hooks genuinely need and cannot get any other way.
 *
 * NOT wired into a route yet: the play route mounts "no such game" until Phase 6 fills the
 * registry (see registry.ts on why a lazy loader with no component to load is deferred). This is
 * the seam a Phase 6 game slots into — `<GameShell manifest={m}><TheGame onExit={…} /></GameShell>`
 * — built now because the economy hooks are built now and need something to read from.
 */
export interface GameShellProps {
  readonly manifest: GameManifest;
  readonly children: ReactNode;
}

export function GameShell({ manifest, children }: GameShellProps) {
  /**
   * PRE-GAME OPTIONS live here because this is the boundary that already exists — one provider per
   * game, mounted by the play route, torn down on exit. The values are the shell's rather than the
   * game's for the same reason the manifest is: a game that owned them would draw its own control
   * (Solitaire did, and that is the hand-rolled shape this seam replaces).
   *
   * THEY ARE DERIVED FROM THE URL AND HELD NOWHERE (plans/GAME_LAUNCH_MODAL.md §4). This used to be
   * a `useState` seeded from the defaults, which had two consequences worth naming: a tier chosen
   * in the launch modal — drawn on the HUB, one navigation before this component exists — had
   * nowhere to live across that navigation, and a mid-lobby refresh silently reset the AI tier to
   * its default while the host believed they had picked one.
   *
   * Seeding the state from the URL would fix both and leave the fact in two places, which is
   * exactly what `<Lobby>`'s `roomId ?? linkedTable` did before the derivation rule caught it. So
   * there is no state: `readOptionValues` is total (a hand-edited query string cannot produce a
   * value a reducer has no branch for), and the write goes back to the URL.
   */
  const spec = manifest.options ?? NO_OPTIONS;
  const [params, setParams] = useSearchParams();
  const optionValues = useMemo(() => readOptionValues(spec, params), [spec, params]);
  const setOption = useCallback(
    (id: string, value: string) => {
      const next = setOptionValue(spec, optionValues, id, value);
      // A refused write (unknown id, unoffered value) returns the same object by identity, and a
      // no-op must stay one: writing it back would push a history entry for a click that changed
      // nothing. `replace` for the same reason `chooseMode` uses it — picking a tier is not a
      // navigation, and the Back button belongs to the pages you visited.
      if (next === optionValues) return;
      setParams(writeOptionValues(params, next), { replace: true });
    },
    [spec, optionValues, params, setParams]
  );

  const value = useMemo(
    () => ({ manifest, optionValues, setOption }),
    [manifest, optionValues, setOption]
  );

  return <GameContextProvider value={value}>{children}</GameContextProvider>;
}
