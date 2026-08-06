import { Button, cx } from '@/ui';
import { pinnedOptionValues } from '@/system/options/options';
import { useGameOptions } from '@/system/options/useGameOptions';

/**
 * The control for a game's declared options — the OS's half of the seam.
 *
 * WHY THE OS DRAWS IT AND THE GAME PLACES IT. "Options are manifest data rendered by the shell,
 * not a `system` prop" (V1_FEATURE_GAPS #2), and this is the shell's renderer: one component, so
 * every game's options look the same and change in one place — which is precisely what v1 lost by
 * letting ~20 games each draw their own dropdown. What the OS does NOT decide is *where* the
 * control sits: a solo game has its own header row (Solitaire drops it beside "New game"), and a
 * room game's belongs in the lobby's pre-game panel. So this renders wherever it is mounted and
 * owns nothing about layout beyond its own row.
 *
 * WHY BUTTONS AND NOT A `<select>`. The kit has no select, and a segmented row is the right
 * control for two or three choices — which is every option any game here declares. A native
 * select would mean a new kit component with one caller, and the kit is the one place raw DaisyUI
 * classes are legal, so it is the most expensive place to add something speculatively. When an
 * option with ten choices exists, that is the argument for `<Select>` in `src/ui`, and this
 * component is the single place that would change.
 *
 * A game with no options renders nothing at all — no empty row, no divider — so mounting this
 * unconditionally is safe and is what the lobby will do when a room game first declares one.
 */
export interface GameOptionsProps {
  readonly className?: string;
  /** Locks the control (a game in flight, or a guest in a room the host configures). */
  readonly disabled?: boolean;
  /**
   * This table is playing for money, so every option declaring `pinnedForMoney` shows its pinned
   * value, locked, with the game's own one-line reason under it. See `GameOption.pinnedForMoney`.
   */
  readonly forMoney?: boolean;
}

export function GameOptions({ className, disabled = false, forMoney = false }: GameOptionsProps) {
  const { spec, values, setOption } = useGameOptions();
  if (spec.length === 0) return null;
  // Rendered from the SAME function the game sends from, so the control cannot show a tier the
  // table is not being played at.
  const shown = pinnedOptionValues(spec, values, forMoney);

  return (
    <div className={cx('flex flex-wrap items-start gap-3', className)}>
      {spec.map((option) => {
        const pin = forMoney ? option.pinnedForMoney : undefined;
        return (
          <div key={option.id} className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <span className="text-bw-muted font-display text-xs tracking-[0.12em] uppercase">
                {option.label}
              </span>
              <div
                className="flex overflow-hidden rounded-md"
                role="group"
                aria-label={option.label}
              >
                {option.choices.map((choice) => {
                  const selected = shown[option.id] === choice.value;
                  // A PINNED OPTION DRAWS ONE BUTTON, not four greyed ones. A disabled row of
                  // choices reads as "broken", where a single locked value reads as "this is what
                  // you are facing" — and it is the accurate picture, since the referee will play
                  // that value whatever this control last said.
                  if (pin !== undefined && !selected) return null;
                  return (
                    <Button
                      key={choice.value}
                      variant={selected ? 'secondary' : 'quiet'}
                      size="sm"
                      disabled={disabled || pin !== undefined}
                      aria-pressed={selected}
                      onClick={() => {
                        setOption(option.id, choice.value);
                      }}
                      className="rounded-none"
                    >
                      {choice.label}
                    </Button>
                  );
                })}
              </div>
            </div>
            {pin !== undefined && (
              <p className="text-bw-muted max-w-64 text-right text-xs">{pin.why}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
