import { Card } from '@/ui';
import type { Seat } from '@/system/room/types';

/**
 * THE TABLE YOU ARE ABOUT TO CREATE, drawn before it exists — v1's lobby preview
 * (plans/GAME_LAUNCH_MODAL.md §5.1), which is the half of that screen worth keeping.
 *
 * It renders `plannedSeats(…)` and nothing else. That is deliberate and it is the whole design:
 * the array on screen is the array the create path produces, so the preview cannot promise a
 * table the create does not deliver. There is no per-kind cleverness in here and there must not
 * be — the moment this component decides what a chair "should" say, it becomes a second opinion
 * about the seat array, which is exactly the thing a preview must never be.
 *
 * A PRESENTATIONAL COMPONENT with no hooks, so it draws the same in the lobby's create panel and
 * (slice 2) inside the launch modal, without either learning where it is.
 */
export interface SeatPreviewProps {
  readonly seats: readonly Seat[];
}

/** The one-word kind, matching `SeatList`'s vocabulary — the two draw the same table. */
const kindLabel = (kind: Seat['kind']): string =>
  kind === 'open' ? 'Open' : kind === 'ai' ? 'CPU' : 'Player';

export function SeatPreview({ seats }: SeatPreviewProps) {
  // A table with no chairs is not a table. Draw nothing rather than an empty box with a heading:
  // `plannedSeats` answers `[]` for a seat count that cannot seat a host, and a preview of nothing
  // is more honest as an absence than as an empty frame.
  if (seats.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <span className="font-display text-bw-muted text-xs font-semibold tracking-[0.2em] uppercase">
        At this table
      </span>
      <Card className="flex flex-col gap-1 p-3">
        {seats.map((seat, i) => (
          <div key={i} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2">
              <span className="font-display text-bw-muted text-[0.6rem] tracking-[0.2em] uppercase">
                {kindLabel(seat.kind)}
              </span>
              <span className={seat.kind === 'open' ? 'text-bw-muted' : 'text-base-content'}>
                {seat.kind === 'open' ? '—' : seat.name}
              </span>
            </span>
            {/* The host is the one seat a joiner cannot take, and saying so here is what makes the
                other rows read as chairs somebody could still walk into. */}
            {i === 0 && (
              <span className="font-display text-bw-muted text-[0.6rem] tracking-[0.2em] uppercase">
                You
              </span>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}
