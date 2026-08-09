import { Button, cx } from '@/ui';
import { useAudio } from '@/system/audio/useAudio';
import { useBet } from '@/system/economy/useBet';
import { formatMoney } from '@boardwalk/game-logic';
import { chipSrc, rackChips } from '@/games/blackjack/chips';

/**
 * THE CHIP RACK, IN THE TABLE — pick chips up, then push them out to the dealer.
 *
 * **IT USED TO BE FIVE TEXT BUTTONS IN A PANEL UNDER THE FELT** — `+$5.00`, `+$25.00`, `+$100.00`,
 * `Max`, `Clear` — which is a form, and it sat outside the object it was betting on. Every other
 * piece of this board learned the same lesson already: UNO's opponents stopped being bordered boxes
 * and became hands, blackjack's chairs stopped being a wrapped flex and went onto an arc, and a
 * wager stopped being grey 12px text and became `<ChipStack>`. The one control the player touches
 * on every single hand was the last thing on the screen still spelled as a spreadsheet.
 *
 * So the rack draws the SAME ART the betting circle does. That is not a flourish: a player stages
 * $30 by clicking a $25 and a $5, and the circle answers with a $25 and a $5. The gesture and the
 * result are the same objects, which is the whole reason a physical chip tray works, and it is free
 * here because `chipSrc` already resolves every denomination to a file on disk.
 *
 * **THE MODIFIER ROW IS v1'S, AND IT IS THE HALF THAT WAS MISSING.** `system_betting.js` shipped
 * REPEAT / ½ / 2× / ALL IN beside its chips, and they are what makes a betting game playable at
 * speed — nobody clicks a $25 chip forty times. `Max` existed here and did ALL IN's job under a
 * name that says nothing about the bankroll.
 *
 * REPEAT is the one that needs a memory, and this component has none by construction: it unmounts
 * the moment the round leaves the betting phase, so anything it remembers dies with the hand it was
 * remembering. `lastWagerCents` therefore comes DOWN from the board, which holds it across rounds —
 * the same reason `<Rematch>`'s gate lives above the component that draws the button.
 *
 * IT STAGES AND IT DOES NOT COMMIT. `useBet()` still owns the amount, the table's min/max from the
 * manifest, and the affordability message under the chips. What it does not do is `commit()`: the
 * wager leaves the bankroll when the referee takes it, in the same transaction that deals, and
 * committing here too would deduct it twice.
 *
 * **IT IS TWO ROWS AND NOT FOUR, and that is a fold decision rather than a taste one.** The first
 * build stacked figure / chips / modifiers / button, which measured ~184px and pushed the felt to
 * 846px — PLACE BET landed on the last pixel of a 1000px viewport and would have been BELOW the
 * fold on a 1080p screen with browser chrome. That is `<GameResult>`'s and `<ExitGame>`'s defect
 * arriving a third time, at the one control a player touches on every single hand. A chip tray on a
 * real table is wide and shallow, so the chips take a row and everything that is not a chip shares
 * the one under it.
 */

/** Chip diameter in the rack, in rem. Big enough to read the printed value, small enough for five. */
const CHIP_REM = 3.25;

export function BetRack({
  onDeal,
  disabled,
  lastWagerCents = 0,
  dealLabel = 'Deal',
}: {
  readonly onDeal: (wagerCents: number) => void;
  readonly disabled: boolean;
  /** What this player staked last round, for REPEAT. 0 (the default) greys the button out. */
  readonly lastWagerCents?: number;
  /** What the commit button says — a solo hand deals, a chair at a table places its bet. */
  readonly dealLabel?: string;
}) {
  const bet = useBet();
  const { play } = useAudio();
  const chips = rackChips(bet.bounds.max);

  /** One of v1's modifiers. `bet.set` snaps into the legal range, so none of these can go illegal. */
  const modifier = (label: string, to: number, enabled: boolean) => (
    <button
      key={label}
      type="button"
      disabled={!enabled || disabled}
      onClick={() => {
        play('click');
        bet.set(to);
      }}
      className={cx(
        'font-display border-bw-line/70 text-bw-muted rounded border px-2.5 py-1 text-[0.65rem]',
        'font-semibold tracking-[0.12em] uppercase transition',
        'hover:border-secondary hover:text-secondary enabled:cursor-pointer',
        'disabled:cursor-not-allowed disabled:opacity-40'
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex w-full flex-col items-center gap-2.5">
      <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
        {chips.map((chip) => {
          // Greyed only when this chip cannot move the bet at all — at the ceiling, not merely
          // when the chip would overshoot it, because `clampBet` snaps an overshoot to the max and
          // "click the big chip to go all in" is how a real rack behaves.
          const spent = bet.amountCents >= bet.maxCents;
          return (
            <button
              key={chip}
              type="button"
              disabled={spent || disabled}
              aria-label={`Bet ${formatMoney(chip)}`}
              onClick={() => {
                play('chip');
                bet.add(chip);
              }}
              className={cx(
                'relative shrink-0 rounded-full transition-transform',
                'enabled:cursor-pointer enabled:hover:-translate-y-1 enabled:active:scale-90',
                'focus-visible:ring-secondary focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:outline-none',
                'disabled:cursor-not-allowed disabled:opacity-40'
              )}
              style={{ width: `${String(CHIP_REM)}rem`, height: `${String(CHIP_REM)}rem` }}
            >
              <img
                src={chipSrc(chip)}
                alt=""
                aria-hidden
                width={256}
                height={256}
                className="h-full w-full drop-shadow-lg"
              />
            </button>
          );
        })}
      </div>

      {/* THE ONE ROW UNDER THE TRAY: what is staged, how to reshape it, and how to send it. v1's
          modifiers, rebuilt — each is a jump to an EXACT total (`set`), never an accumulation, so a
          double-tap on 2× is not four times the bet, it is the same total twice. */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-bw-muted text-[0.6rem] font-semibold tracking-[0.18em] uppercase">
            Bet
          </span>
          <span
            data-money
            className="font-display text-accent text-shadow-neon-gold text-xl font-bold tracking-tight tabular-nums"
          >
            {formatMoney(bet.amountCents)}
          </span>
        </div>

        <div className="flex flex-wrap justify-center gap-1.5">
          {modifier('Repeat', lastWagerCents, lastWagerCents > 0)}
          {modifier('½', Math.floor(bet.amountCents / 2), bet.amountCents > bet.bounds.min)}
          {modifier('2×', bet.amountCents * 2, bet.amountCents < bet.maxCents)}
          {modifier('All in', bet.maxCents, bet.maxCents > bet.amountCents)}
          {modifier('Clear', bet.bounds.min, bet.amountCents > bet.bounds.min)}
        </div>

        <Button
          variant="primary"
          size="sm"
          className="min-w-[9rem]"
          disabled={!bet.canCommit || disabled}
          onClick={() => {
            play('shuffle');
            play('deal');
            onDeal(bet.amountCents);
          }}
        >
          {disabled ? 'Dealing…' : dealLabel}
        </Button>
      </div>

      {!bet.check.ok && <p className="text-bw-muted text-xs">{bet.check.error}</p>}
    </div>
  );
}
