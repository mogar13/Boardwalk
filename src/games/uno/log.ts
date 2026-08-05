import type { Card, UnoEvent } from '@boardwalk/game-logic/games/uno';

/**
 * THE TABLE'S COMMENTARY — one `UnoEvent` (facts, from the rulebook) turned into the lines v1's
 * `#move-log` printed.
 *
 * This is a game-folder module and not part of the shared rulebook on purpose: it is COPY. The
 * referee has no use for "draws 2 and is skipped!", and a rule that both sides must agree about is
 * the only thing `packages/game-logic` is for. What it shares with the rulebook is being pure and
 * tested — `tests/uno-log.test.ts` — because the interesting part is not the wording, it is that ONE
 * move can be several lines (a wild draw-four is a play, a victim drawing four, a seat skipped and,
 * if it was the last but one card, an UNO call) and every one of those has to survive a rename, a
 * spectator with no seat, and a bot seat with no name.
 *
 * A line names seats by INDEX and resolves through `names` at the end, so a player renaming
 * themselves does not leave old lines addressed to a name nobody has. v1 baked the sender's copy of
 * everyone's names into the wire format and could not do this.
 */

export interface LogLine {
  /** Stable within a round: the event's seq plus which line of that event this is. */
  readonly key: string;
  /** The seat the line is ABOUT, or `-1` for a table-wide line ("Direction reversed!"). */
  readonly seat: number;
  /** The sentence, with the seat's name already substituted; `card` renders after it. */
  readonly text: string;
  /** A card to draw inline after the text (the played card), or `null`. */
  readonly card: Card | null;
  /** A line the table says, not a player — rendered muted, v1's `SYSTEM:` prefix. */
  readonly system: boolean;
}

/** A seat's display name, falling back the way the rest of the board does. */
function nameOf(names: readonly string[], seat: number): string {
  const n = names[seat];
  return n === undefined || n === '' ? `Player ${String(seat + 1)}` : n;
}

/** A card as words, for the log (the face art carries the colour; the log has to say it). */
export function cardLabel(card: Card): string {
  if (card.kind === 'wild') return 'a WILD';
  if (card.kind === 'wild4') return 'a WILD DRAW FOUR';
  const face =
    card.kind === 'number'
      ? String(card.value)
      : card.kind === 'skip'
        ? 'SKIP'
        : card.kind === 'reverse'
          ? 'REVERSE'
          : 'DRAW TWO';
  return `${card.color.toUpperCase()} ${face}`;
}

/**
 * The lines one event produces, in the order they should read. Empty for the deal sentinel and for
 * a refused move — `describeMove` returns that same sentinel when the reducer changed nothing, so a
 * rejected intent silently produces no commentary rather than a line claiming it happened.
 */
export function linesFor(event: UnoEvent, names: readonly string[]): LogLine[] {
  if (event.action === 'deal' || event.seat < 0) return [];
  const out: LogLine[] = [];
  const key = (n: number): string => `${String(event.seq)}-${String(n)}`;
  const actor = nameOf(names, event.seat);

  if (event.action === 'draw') {
    out.push({
      key: key(0),
      seat: event.seat,
      text: `${actor} drew a card.`,
      card: null,
      system: false,
    });
  } else {
    out.push({
      key: key(0),
      seat: event.seat,
      text: `${actor} played`,
      card: event.card,
      system: false,
    });
  }

  if (event.victim >= 0 && event.drew > 0) {
    const victim = nameOf(names, event.victim);
    out.push({
      key: key(1),
      seat: event.victim,
      text: `${victim} draws ${String(event.drew)} and is skipped!`,
      card: null,
      system: true,
    });
  } else if (event.skipped >= 0) {
    // Only when nobody drew: a draw-2 already SAYS "and is skipped", and printing both is v1's
    // double-announcement, which reads as two different things happening to one player.
    out.push({
      key: key(1),
      seat: event.skipped,
      text: `${nameOf(names, event.skipped)} is skipped!`,
      card: null,
      system: true,
    });
  }

  if (event.reversed) {
    out.push({ key: key(2), seat: -1, text: 'Direction reversed!', card: null, system: true });
  }
  if (event.calledUno) {
    out.push({
      key: key(3),
      seat: event.seat,
      text: `${actor} yelled UNO!`,
      card: null,
      system: false,
    });
  }
  if (event.penalty) {
    out.push({
      key: key(4),
      seat: event.seat,
      text: `${actor} forgot to yell UNO — +2 penalty.`,
      card: null,
      system: true,
    });
  }
  if (event.winner >= 0) {
    out.push({
      key: key(5),
      seat: event.winner,
      text: `${nameOf(names, event.winner)} went out and WINS!`,
      card: null,
      system: true,
    });
  }
  return out;
}
