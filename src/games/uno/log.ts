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

/**
 * A card as words, for the log — the card's NAME, in title case, with no article.
 *
 * IT USED TO SHOUT: `RED 5`, `a WILD DRAW FOUR`. The log paints this label in the card's own colour
 * (`MoveLog`'s `CARD_TEXT`), so an all-caps colour word says the same thing twice on the one
 * surface that exists to be read at a glance — and it was the only shouting on the page, which made
 * a running commentary read like an alarm. Title case, and the colour carries the colour.
 *
 * The article went with it. `RED 5` never had one and `a WILD` did, so one move read "played Red 5"
 * and the next "played a Wild" — treating the label as a card's NAME makes both of them the same
 * sentence, and it is what the log is doing anyway.
 */
export function cardLabel(card: Card): string {
  if (card.kind === 'wild') return 'Wild';
  if (card.kind === 'wild4') return 'Wild Draw Four';
  const face =
    card.kind === 'number'
      ? String(card.value)
      : card.kind === 'skip'
        ? 'Skip'
        : card.kind === 'reverse'
          ? 'Reverse'
          : 'Draw Two';
  return `${card.color.charAt(0).toUpperCase()}${card.color.slice(1)} ${face}`;
}

/**
 * The lines one event produces, in the order they should read. Empty for the deal sentinel and for
 * a refused move — `describeMove` returns that same sentinel when the reducer changed nothing, so a
 * rejected intent silently produces no commentary rather than a line claiming it happened.
 */
export function linesFor(event: UnoEvent, names: readonly string[]): LogLine[] {
  // THE DEAL. It says one thing and only from the second round on: who won the last one and is
  // therefore leading this one. Without it the turn simply starts on somebody who is not the host
  // and nobody at the table knows why — the rule is invisible, and an invisible rule reads as a bug.
  if (event.action === 'deal') {
    if (event.leads < 0) return [];
    return [
      {
        key: `${String(event.seq)}-lead`,
        seat: event.leads,
        text: `${nameOf(names, event.leads)} won the last round and leads.`,
        card: null,
        system: true,
      },
    ];
  }
  if (event.seat < 0) return [];
  const out: LogLine[] = [];
  const key = (n: number): string => `${String(event.seq)}-${String(n)}`;
  const actor = nameOf(names, event.seat);

  if (event.action === 'draw') {
    // TAKING A STACK IS STILL A DRAW, and saying "drew a card" for six is the log lying about the
    // only thing in a hidden-hand game a player cannot see for themselves. `took` and not the
    // victim line, because nobody was skipped — the taker spent their own turn.
    out.push({
      key: key(0),
      seat: event.seat,
      text:
        event.took > 1
          ? `${actor} took the stack — ${String(event.took)} cards.`
          : `${actor} drew a card.`,
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

  // THE RUNNING TOTAL. Under stacking a +2 deals nobody anything and skips nobody, so every line
  // above is silent about it and the table would see a card played and six cards appear two turns
  // later with nothing said in between. Seat-neutral on purpose: the debt is aimed at whoever is on
  // turn, which the felt already shows, and naming them here would need a field the event does not
  // carry and could not keep true after the next move.
  if (event.stacked > 0) {
    out.push({
      key: key(6),
      seat: -1,
      text: `Stack is now +${String(event.stacked)} — answer it or take it.`,
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
  // GOING OUT AND WINNING CAME APART when ranked places arrived, and the log is where that shows.
  // Ordinarily they are the same move: `place` is 1 and the round is over, so this reads exactly as
  // it always did. Playing for places, first place is settled several moves before the round is —
  // so a seat that goes out gets its placement line here and now, and the round's end gets a line of
  // its own that names nobody, because by then the winner left the table three moves ago and
  // "X went out and WINS!" would be a sentence about the wrong moment.
  if (event.place > 0) {
    const won = event.winner === event.seat && event.place === 1;
    out.push({
      key: key(5),
      seat: event.seat,
      text: won
        ? `${actor} went out and WINS!`
        : `${actor} goes out — ${ordinal(event.place)} place.`,
      card: null,
      system: true,
    });
  }
  if (event.winner >= 0 && event.winner !== event.seat) {
    out.push({
      key: key(7),
      seat: -1,
      text: `Round over — ${nameOf(names, event.winner)} took it.`,
      card: null,
      system: true,
    });
  }
  return out;
}

/**
 * "1st", "2nd", "3rd"… A table seats seven, so this only ever has to reach 7th and the English
 * exceptions at 11–13 never arise — but they are handled anyway, because the rule is two lines and
 * the alternative is a function that is quietly wrong for a table size nobody has tried yet.
 */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${String(n)}th`;
  const suffix = n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${String(n)}${suffix}`;
}
