import { Button } from '@/ui';

/**
 * `<ExitGame>` — THE WAY OUT OF A GAME, DRAWN BY THE OS. One control, one destination, every game.
 *
 * WHAT WENT WRONG, and it went wrong twice in the same place. A room game's page carried TWO ways
 * out: "Leave table" in the header, and "Back to the hub" at the very bottom of the column, under
 * the seat list / the board / the chat. They did different things — the header one only dropped
 * `?table=` and left you on the game's create-or-join screen, the hub one navigated — and the one
 * that actually took you to the boardwalk was the one BELOW THE FOLD. So leaving a table meant
 * either landing on a setup form nobody asked for, or scrolling past a full felt to find the
 * button. That is `<GameResult>`'s defect exactly: the control a player wants at a specific moment,
 * placed where it is only reachable by scrolling.
 *
 * SO THE RULE IS: **LEAVE TABLE = BACK TO THE HUB.** There is one exit, it is in the header, and it
 * goes to the boardwalk. Getting back to a table's setup screen is what the browser's Back button
 * is for — `enterTable` pushes a history entry precisely so that works — and it is not a thing the
 * page needs to offer twice.
 *
 * WHY A COMPONENT AND NOT A CONVENTION. Three surfaces draw this (the lobby's in-room header, and
 * the two solo games that have no lobby to draw one for them), and before this they were three
 * spellings of one idea: "Leave table" `quiet`, "Leave table" `quiet`, and Solitaire's "Leave". A
 * label the OS owns cannot drift, and a destination the OS owns cannot become "somewhere else, on
 * this one screen". Same argument `<Avatar>` and `<GameResult>` already won: collapse the copies in
 * the commit that first needs them to agree. `tests/game-exit.test.ts` is the teeth.
 *
 * WHY `ghost` AND NOT `quiet`. `quiet` is "the thing next to the real action" — no border, no
 * glow, muted until touched — and it is genuinely hard to see on a felt: the exit was reported
 * missed on a board it was sitting at the top of. `ghost` is the kit's unlit tube: a bordered
 * control that is unmistakably a control, that strikes cyan on hover, and that still does not
 * compete with the one lit `primary` on the page (Start, Deal again). It is not an action you want
 * to make loud — just one you must be able to find without hunting.
 */
export interface ExitGameProps {
  /** The one prop a game receives, passed straight through. It navigates to the hub. */
  readonly onExit: () => void;
}

export function ExitGame({ onExit }: ExitGameProps) {
  return (
    <Button variant="ghost" size="sm" onClick={onExit}>
      {/* Not a decoration: the arrow is what says this leaves rather than does something here. */}
      <span aria-hidden>←</span> Leave table
    </Button>
  );
}
