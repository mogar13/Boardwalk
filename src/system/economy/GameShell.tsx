import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { GameManifest } from '@/games/registry';
import { GameContextProvider } from '@/system/economy/gameContext';
import {
  defaultOptionValues,
  NO_OPTIONS,
  setOptionValue,
  type OptionValues,
} from '@/system/options/options';

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
  // PRE-GAME OPTIONS live here because this is the boundary that already exists — one provider per
  // game, mounted by the play route, torn down on exit. The state is the shell's rather than the
  // game's for the same reason the manifest is: a game that owned it would draw its own control
  // (Solitaire did, and that is the hand-rolled shape this seam replaces).
  const spec = manifest.options ?? NO_OPTIONS;
  const [optionValues, setOptionValues] = useState<OptionValues>(() => defaultOptionValues(spec));
  const setOption = useCallback(
    (id: string, value: string) => {
      setOptionValues((current) => setOptionValue(spec, current, id, value));
    },
    [spec]
  );

  const value = useMemo(
    () => ({ manifest, optionValues, setOption }),
    [manifest, optionValues, setOption]
  );

  return <GameContextProvider value={value}>{children}</GameContextProvider>;
}
