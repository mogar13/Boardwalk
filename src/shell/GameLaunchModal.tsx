import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Modal } from '@/ui';
import type { RegisteredGame } from '@/games/registry';
import { GameShell } from '@/system/economy/GameShell';
import { GameOptions } from '@/system/options/GameOptions';
import { useGameOptions } from '@/system/options/useGameOptions';
import { MODE_HINT, type GameMode, type RoomMode } from '@/system/room/modes';
import { TableSetup } from '@/system/room/TableSetup';
import { isRoomMode, launchModes, launchStepFor, playPath } from '@/shell/launch';

/**
 * THE ENTRANCE — one modal, every game (plans/done/GAME_LAUNCH_MODAL.md).
 *
 * Clicking a game used to navigate to `/play/:id`, which mounts the game, which mounts `<Lobby>`,
 * whose no-table branch is a full PAGE of create/join panels. So three of the six games answered
 * "I want to play UNO" with a form — and the form arrived behind a route change and a lazy chunk,
 * under the "Dealing you in…" fallback. This is v1's `openLaunchPanel` rebuilt on the kit: the card
 * opens a modal, the modal offers the game's ways in, and picking a multiplayer one swaps to the
 * host-setup step. An entrance that makes you wait is not an entrance.
 *
 * IT LIVES OVER THE HUB, not over the play route, and that is the whole reason it is instant: here
 * the manifest is a static import (`registry.ts`), where a setup modal at `/play/uno` would arrive
 * only after the game's chunk did.
 *
 * ONE MODAL, TWO STEPS — not two modals. Stacking a second `<dialog>` would be the literal
 * transcription of v1's two panels, and the uniformity complaint is precisely that they look like
 * they came from different applications. One `<Modal>` whose title and body change, with a back
 * affordance on the setup step, is one look by construction.
 *
 * IT MOUNTS A THROWAWAY `<GameShell>`, purely so `<GameOptions>` has a context to read — one
 * control, rather than a second implementation of a segmented picker on the hub. Its values are
 * disposable because they do not live in it: they live in the URL (`optionParams.ts`), which is
 * what carries a tier picked here across the navigation that follows, and the play route mounts
 * the real shell reading the same place.
 */
export interface GameLaunchModalProps {
  /** The game whose entrance is open, or `null` for closed. */
  readonly game: RegisteredGame | null;
  readonly onClose: () => void;
}

export function GameLaunchModal({ game, onClose }: GameLaunchModalProps) {
  /**
   * Three pieces of state, and each is doing something.
   *
   * `shown` LAGS the prop by one close: it keeps the last game for the 200ms the dialog spends
   * animating out. `open` goes false before the box is gone, so rendering `game` directly would
   * blank the title and body first and fade an empty frame — which reads as the modal breaking
   * rather than closing.
   *
   * `opened` is the prop as it last was, which is the only way to tell a REOPEN from a re-render:
   * closing on the setup step and clicking the same card again must land back on the ways in. This
   * is an entrance, not a form you resume.
   *
   * `mode` is which step is on screen, and it is HERE rather than in the body because the modal's
   * width depends on it (§3): the ways in are three buttons and the setup step is two columns.
   *
   * All adjusted during render rather than in an effect (React's own "storing information from
   * previous renders" pattern) — an effect would paint the stale frame once before correcting it,
   * which is the flash this exists to avoid.
   */
  const [opened, setOpened] = useState<RegisteredGame | null>(game);
  const [shown, setShown] = useState<RegisteredGame | null>(game);
  const [mode, setMode] = useState<GameMode | null>(null);
  if (game !== opened) {
    setOpened(game);
    if (game !== null) {
      setShown(game);
      setMode(null);
    }
  }

  return (
    <Modal
      open={game !== null}
      onClose={onClose}
      title={shown?.manifest.name ?? 'Play'}
      description={shown?.manifest.blurb}
      /*
        THE WIDTH IS THE STEP'S, which is what `size` was added for (§3). The ways in are two or
        three buttons — at `lg` they are a 768px box holding a column of nothing, which reads as a
        panel that failed to load the rest of itself. The setup step is a seat picker, a stake row,
        house-rule toggles, a seat preview and the two ways to join somebody else's table, in two
        columns, and at the old fixed `max-w-lg` that was a form you scroll.
      */
      size={mode === null ? 'sm' : 'lg'}
    >
      {shown !== null && (
        // KEYED BY GAME, so the panel's own state (seat count, stake, rules) belongs to one game
        // and cannot outlive it. A remount is the honest reset: none of it means anything about
        // the next game.
        <LaunchBody
          key={shown.manifest.id}
          game={shown}
          mode={mode}
          onPick={setMode}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function LaunchBody({
  game,
  mode,
  onPick,
  onClose,
}: {
  game: RegisteredGame;
  mode: GameMode | null;
  onPick: (mode: GameMode | null) => void;
  onClose: () => void;
}) {
  const modes = launchModes(game.manifest);

  return (
    // The shell wraps BOTH steps, not just the one that draws options: the navigation carries the
    // chosen values, and it is composed by whichever step fires it (see `useLaunch`).
    <GameShell manifest={game.manifest}>
      {mode === null ? (
        <div className="flex flex-col gap-4">
          {modes.map(({ mode: m, label }) => (
            <ModeChoice
              key={m}
              game={game}
              mode={m}
              label={label}
              onPick={() => {
                onPick(m);
              }}
              onClose={onClose}
            />
          ))}
        </div>
      ) : (
        <LaunchStep
          game={game}
          mode={mode}
          onBack={
            modes.length > 1
              ? () => {
                  onPick(null);
                }
              : undefined
          }
          onClose={onClose}
        />
      )}
    </GameShell>
  );
}

/**
 * One way in: the button, and one line saying what it does.
 *
 * The hint is a line UNDER the button rather than a second line inside it, because the kit's
 * `<Button>` is a fixed-height sign — two lines of type in one would mean overriding its height and
 * its `whitespace-nowrap` from the call site, which is the per-caller drift the kit exists to stop.
 *
 * It NAVIGATES ON THE CLICK when the game has nothing to ask (Blackjack today) rather than
 * advancing to an empty panel with a Play button under it. Decision 3 is that every game gets the
 * modal, not that every game gets two steps.
 */
function ModeChoice({
  game,
  mode,
  label,
  onPick,
  onClose,
}: {
  game: RegisteredGame;
  mode: GameMode;
  label: string;
  onPick: () => void;
  onClose: () => void;
}) {
  const go = useLaunch(game, onClose);
  const hint = MODE_HINT[mode];
  return (
    <div className="flex flex-col gap-1">
      <Button
        block
        size="lg"
        variant="secondary"
        onClick={() => {
          if (launchStepFor(game.manifest, mode) === 'none') go({});
          else onPick();
        }}
      >
        {label}
      </Button>
      {hint !== undefined && <p className="text-bw-muted text-center text-xs">{hint}</p>}
    </div>
  );
}

/** The setup step: a table to configure, or the handful of choices a solo game declares. */
function LaunchStep({
  game,
  mode,
  onBack,
  onClose,
}: {
  game: RegisteredGame;
  mode: GameMode;
  onBack?: (() => void) | undefined;
  onClose: () => void;
}) {
  const go = useLaunch(game, onClose);

  return (
    <div className="flex flex-col gap-4">
      {/*
        Absent for a game with one way in — a back button to a screen that offered no choice is a
        step nobody took.

        `ghost` AND NOT `quiet`. `quiet` is "no tube at all": muted text on nothing, which is
        correct for a Cancel sitting next to a real action and wrong for the ONLY way back off a
        screen. On the felt it rendered as grey text floating between the modal's description and
        a bordered panel, and people did not read it as a control at all — it looks like a caption.
        `ghost` is the unlit tube: a border, so it reads as pressable, and it strikes cyan on hover
        like every other secondary control here. It still cannot compete with Create, which is the
        one lit `primary` on the panel.
      */}
      {onBack !== undefined && (
        <Button variant="ghost" size="sm" className="self-start" onClick={onBack}>
          ← Ways to play
        </Button>
      )}
      {isRoomMode(mode) ? (
        // The SAME panel the lobby renders, which never learns which of the two it is in. Create
        // hands back a room id and the navigation lands straight in the live table.
        <TableSetup
          manifest={game.manifest}
          mode={mode}
          onEntered={(roomId) => {
            go({ table: roomId, mode });
          }}
        />
      ) : (
        <div className="flex flex-col items-start gap-5">
          {/* `panel` for the same reason the create panel uses it: this is a configuration panel,
              not a game's own header row, and a small inline label with nothing above it is the
              control people were missing. */}
          <GameOptions layout="panel" />
          <Button
            variant="primary"
            onClick={() => {
              go({});
            }}
          >
            Deal me in
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * GO — the navigation, composed where the chosen options can be read.
 *
 * `useGameOptions()` resolves against the same URL `<GameShell>` writes, so what rides to
 * `/play/:id` is exactly what the control showed. The modal closes on the way out because the hub
 * stays mounted behind it, and a dialog left open across a route change is the "why is this still
 * here" bug.
 */
function useLaunch(game: RegisteredGame, onClose: () => void) {
  const navigate = useNavigate();
  const { values } = useGameOptions();
  return (args: { table?: string; mode?: RoomMode }) => {
    onClose();
    void navigate(playPath({ gameId: game.manifest.id, options: values, ...args }));
  };
}
