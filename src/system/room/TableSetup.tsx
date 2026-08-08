import { useState } from 'react';
import { Button, Card, cx, FIELDSET_LEGEND, Fieldset, Input, useToast } from '@/ui';
import type { GameManifest } from '@/games/registry';
import { GameOptions } from '@/system/options/GameOptions';
import { useAuthStore } from '@/system/auth/authStore';
import { formatMoney } from '@boardwalk/game-logic';
import { repos } from '@/system/repo';
import { RoomBrowser } from '@/system/room/RoomBrowser';
import { anteChoices, DEFAULT_ANTE_CENTS, parseAnte, tableBacking } from '@/system/room/ante';
import {
  houseRuleChoices,
  isRuleAvailable,
  isRuleOn,
  NO_TABLE_RULES,
  setTableRule,
  tableRulesFor,
  type TableRules,
} from '@/system/room/houseRules';
import type { RoomMode } from '@/system/room/modes';
import { SeatPreview } from '@/system/room/SeatPreview';
import {
  humanCapacity,
  localSeatName,
  plannedSeats,
  tableSizeChoices,
  type SeatFill,
} from '@/system/room/seats';
import type { RoomVisibility } from '@/system/room/types';

/**
 * THE WAYS TO A TABLE — create one, browse for one, or type its code. ONE implementation
 * (plans/done/GAME_LAUNCH_MODAL.md §2), mounted in two places:
 *
 *   • `<GameLaunchModal>`, over the hub — the entrance, where a click on a game card lands.
 *   • `<Lobby>`, on the play route — because `/play/uno` typed directly, and a shared table link
 *     whose room has closed, both still arrive with no table to be at.
 *
 * The second is why this is a component rather than a screen inside the modal: the panel must not
 * exist twice, and the version that would rot is the one nobody reaches by clicking.
 *
 * IT NEVER LEARNS WHERE IT IS. `{ manifest, mode, onEntered }` and nothing else — no `inModal`
 * flag, no variant. What differs between the two homes is entirely the caller's: the lobby is
 * already at the right route and writes `?table=`, while the modal has to navigate to the game
 * first. Neither concern belongs in a create panel, and a component that knew which one it was in
 * would grow a second layout the day one of them changed.
 *
 * THE MODE IS A PROP, not a control here. `<Lobby>` owns it because the mode lives in the URL (see
 * that file for why that is a correctness property), and the modal owns it because picking a way in
 * IS its first step. Either way this component reads it and maps it to a seat fill, which is the
 * one place in the app that turns a mode into a fill — `seats.ts` deliberately refuses to.
 */
export interface TableSetupProps {
  readonly manifest: GameManifest;
  readonly mode: RoomMode;
  /** A table was created, found or typed — the caller decides what "go there" means. */
  readonly onEntered: (roomId: string) => void;
}

/**
 * WHETHER A STAKE PICKER IS DRAWN AT ALL — the mirror of what `createTable` sends, hoisted out of
 * the component because the panel's WIDTH depends on it (see `setupHasTwoColumns`) and a second
 * spelling of it would be a modal sized for a control that is not there.
 *
 * ONLINE, or AI at a game the house will bank. A visible ante on a table that can never pay one
 * out is the same lie as a visibility toggle on a table that is never listed.
 */
function anteIsOffered(manifest: GameManifest, mode: RoomMode): boolean {
  const houseBanks = manifest.betting?.house === true;
  return (mode === 'online' || houseBanks) && anteChoices(manifest.betting).length > 1;
}

/**
 * WHETHER THIS GAME'S CREATE PANEL FILLS TWO COLUMNS, which is a question about the MANIFEST and
 * therefore answerable before the panel is mounted. Two readers, and that is the whole reason it
 * is exported rather than a local:
 *
 *   • the panel itself, which splits its controls only when there is something to put on both
 *     sides — a second column holding nothing is a panel that looks half-loaded, and four of the
 *     six games put neither a stake nor a house rule on the table;
 *   • `launchWidthFor`, so the modal opens at the width the panel needs. Chess hot-seat's setup is
 *     a heading and a Create button: at the width UNO wants, that is a 1280px box holding one
 *     button, which is the "panel that failed to load the rest of itself" the size rungs exist to
 *     avoid, reproduced one rung further up.
 *
 * One function, so the box and its contents cannot disagree about how much there is to show.
 */
export function setupHasTwoColumns(manifest: GameManifest, mode: RoomMode): boolean {
  return anteIsOffered(manifest, mode) || houseRuleChoices(manifest.houseRules).length > 0;
}

export function TableSetup({ manifest, mode, onEntered }: TableSetupProps) {
  const session = useAuthStore((s) => s.session);
  const toast = useToast();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [visibility, setVisibility] = useState<RoomVisibility>('public');
  // HOW MANY CHAIRS. Defaults to `seats.min` — the SMALLEST table, not the largest.
  //
  // The first draft defaulted to `seats.max` on the "default is whatever already shipped" rule that
  // AI difficulty follows. That rule is about not silently RETUNING a game under someone, and a seat
  // count is not a tuning knob: defaulting to the biggest table reproduces exactly the friction this
  // control exists to remove, for everyone who does not notice the control. Sitting down to UNO meant
  // adding six CPUs before you could press Start, and a picker you have to find first does not fix
  // that. The smallest table is the one you can start on your own, which is what a player opening a
  // game alone is trying to do; anybody who wants a full house is one tap away.
  const sizeChoices = tableSizeChoices(manifest.seats);
  const [seatCount, setSeatCount] = useState(manifest.seats.min);
  // WHAT A CHAIR COSTS. Chosen here, at create, because it is stamped onto the room and every
  // joiner is bound by it — the seat-count argument, with money behind it: a table cannot grow a
  // chair under someone who joined by code, and it must certainly not raise the stakes on them.
  // Defaults to nothing (`DEFAULT_ANTE_CENTS`), so no chip ever moves because a control went
  // unnoticed.
  const anteOptions = anteChoices(manifest.betting);
  const [rungCents, setRungCents] = useState(DEFAULT_ANTE_CENTS);
  /**
   * THE TYPED STAKE, or `null` while a rung is chosen — and it is a STRING, because it is what is
   * in the box rather than what the box means. `parseAnte` turns one into the other and the panel
   * holds no second copy of the answer, which is the same derivation rule `<Lobby>`'s
   * `roomId ?? linkedTable` was fixed by and the reason `<GameShell>` stopped mirroring the URL: a
   * value plus a parse plus a stored number is two sources of truth for one stake, and the one that
   * goes stale is the one the Create button reads.
   */
  const [typedAnte, setTypedAnte] = useState<string | null>(null);
  // WHAT GAME THIS TABLE IS PLAYING. The ante's sibling, and create-time for the same reason with
  // the money taken out: a table must not change the rules under a player who already sat down.
  // Defaults to nothing on — every house rule off IS the game as it already plays, so a host who
  // does not touch this gets exactly the table that existed before the control did.
  const ruleSpecs = houseRuleChoices(manifest.houseRules);
  const [houseRules, setHouseRules] = useState<TableRules>(NO_TABLE_RULES);

  if (session === null) {
    return (
      <Card className="p-6">
        <p className="text-bw-muted text-sm">Sign in to play at a table.</p>
      </Card>
    );
  }
  const myUid = session.uid;

  // THE HOUSE WILL BANK A LONE PLAYER, if the game declared that it has measured what its bots are
  // worth. That single flag is what lets an 'ai' table charge an ante at all — before it, betting
  // needed two humans everywhere, so a table of bots had nothing to win and the picker was hidden.
  const houseBanks = manifest.betting?.house === true;

  /**
   * WHAT THIS TABLE COSTS A CHAIR — derived, never stored. A typed stake that does not parse leaves
   * the last rung standing for the copy below (so the panel does not blank out mid-keystroke) and
   * BLOCKS Create, because the alternative is a host who typed `$2` at a $25 game, saw the error,
   * pressed the lit button anyway and made a table at whatever the rung row last said. A create
   * that quietly ignores the field you are looking at is worse than one that waits.
   */
  const parsedAnte = typedAnte === null ? null : parseAnte(typedAnte, manifest.betting);
  const anteError = parsedAnte !== null && !parsedAnte.ok ? parsedAnte.error : null;
  const anteCents = parsedAnte !== null && parsedAnte.ok ? parsedAnte.cents : rungCents;

  /**
   * WHAT THE EMPTY CHAIRS COME UP HOLDING (plans/done/GAME_LAUNCH_MODAL.md §5.2). The one place in the
   * app that turns a mode into a fill — `seats.ts` deliberately refuses to, because "below this
   * line there is no mode, only seats".
   *
   * ONLINE STAYS OPEN, and that is a decision rather than an omission (§5.3): a public table that
   * comes up full starts before anyone can walk up to it, which is the wrong default for the one
   * mode whose entire point is other people. The host fills it from the room instead — that is
   * what "Fill with CPUs" in `SeatList` is for.
   */
  const fill: SeatFill = mode === 'ai' ? 'ai' : mode === 'hotseat' ? 'local' : 'none';
  const host = { uid: myUid, name: session.username || 'Player' };
  // The array the preview draws AND the array the create is about to produce — one call, so the
  // preview cannot promise a table create does not deliver. See `plannedSeats`.
  const planned = plannedSeats({ seatCount, host, fill });
  /**
   * WHO WOULD PAY FOR THIS TABLE, as far as a table that does not exist yet can say — which is
   * only ever enough to decide what to lock (`pinnedForMoney`), never what to pay.
   *
   * `humanCapacity` and not `humanCount`: a planned online table holds one human and a row of open
   * chairs, and counting only the seated one would answer "the house banks this", locking UNO's bot
   * tier at `sharp` on the strength of a guess that nobody else will ever join. An AI table has no
   * open chairs by construction, so it answers `'house'` — which is the arrangement the pin exists
   * for and the one place a lone player is genuinely playing the building.
   */
  const backing = tableBacking(manifest.betting, anteCents, humanCapacity(planned));

  /**
   * WHICH SECTIONS THIS GAME ACTUALLY DRAWS — named up front because the LAYOUT reads them, and
   * read through `setupHasTwoColumns` rather than re-derived, because the modal around this panel
   * sizes itself from the same answer.
   */
  const showAnte = anteIsOffered(manifest, mode);
  const showRules = ruleSpecs.length > 0;
  const splitControls = setupHasTwoColumns(manifest, mode);

  const createTable = () => {
    setBusy(true);
    void (async () => {
      const result = await repos.room.create(manifest.id, {
        seatCount,
        host,
        // AN 'AI' TABLE IS NEVER LISTED, whatever the toggle last said. The mode is otherwise a
        // client-side matter (it decides which seats are LOCAL, nothing about the room), but a
        // player who picked "vs the house" is not asking for company, and a stranger arriving in
        // their game is a surprise the browser has no business creating. The control is hidden in
        // that mode for the same reason — a visible toggle that cannot change the outcome is
        // worse than none.
        visibility: mode === 'online' ? visibility : 'private',
        // AN 'AI' TABLE ANTES ONLY IF THE HOUSE WILL BANK IT. It never did before slice 5, and the
        // reason was sound while it held: betting needed two humans, an AI table has exactly one by
        // construction, and charging a stake that could only ever be handed back to the person who
        // paid it is worse than not offering it. What changed is not the reasoning but the fact —
        // UNO measured what a player wins against its own `sharp` bots, so there is now a
        // counterparty and a price. A game that has NOT measured it still zeroes here, and the
        // control is hidden with it.
        anteCents: mode === 'online' || houseBanks ? anteCents : 0,
        // NOT mode-gated, unlike the two above, and the difference is the point: those are both
        // about other PEOPLE (who may join, who can be charged), so an AI table zeroes them. A
        // house rule is about the GAME, and a table of bots plays the same game a table of humans
        // does. `tableRulesFor` sends only what is on and only what this game declares.
        houseRules: tableRulesFor(houseRules, ruleSpecs),
        // THE HOUSE SITS DOWN WITH YOU, inside the create itself. Not a loop of `setAi` calls
        // afterwards: the referee seats them in the same construction as the host, so the table is
        // never observably half-filled and a stranger cannot walk into a chair the host is about to
        // fill. See `store.create`.
        fillAi: fill === 'ai',
      });
      if (!result.ok) {
        setBusy(false);
        toast.error(result.error);
        return;
      }
      /**
       * A HOT-SEAT TABLE IS FILLED BY THE CLIENT, and the asymmetry with `fillAi` above is the
       * design rather than an inconsistency (§5.2). A seat carrying a uid must be written by the
       * account that owns it — the one seat rule the server cannot keep on somebody's behalf — so
       * the extra local players are ordinary claims from the host's own socket. Chess is the only
       * hot-seat game and its table is two chairs, so this is ONE call, on a private table nobody
       * can race; a `fillLocal` wire field would be more surface than the case deserves.
       *
       * Sequential and awaited before entering, so the table the room mounts is the table the
       * preview drew — arriving to a half-seated board and watching chairs fill in is the same
       * "wait, is this working?" the six clicks were.
       */
      if (fill === 'local') {
        for (let i = 1; i < planned.length; i += 1) {
          await repos.room.claimSeat(manifest.id, result.value, i, {
            uid: myUid,
            name: localSeatName(i),
          });
        }
      }
      setBusy(false);
      onEntered(result.value);
    })();
  };

  return (
    /*
      TWO PANELS ON A WIDE SCREEN: make on the left, join on the right. v1 stacked them in one
      scrolling column and then dimmed the host settings to 30% opacity the moment you typed in the
      join-code box — an apology for a layout that made it genuinely unclear which half the button
      at the bottom belonged to (§1). The two panels remove the ambiguity instead, so there is
      nothing to dim, and on a narrow screen they stack back with the create panel first.

      IT SIZES ITSELF OFF ITS OWN BOX, NOT THE WINDOW — `@container`, and that is a correctness
      property here rather than a flourish. This component has two homes of very different widths
      (a modal capped at 80rem, and `/play/:id`'s page inside the shell's `max-w-[110rem]`), and a
      viewport breakpoint answers the same in both: it would put two columns inside a 736px modal
      on a 1440px screen. A container query asks the only question that matters — how wide is the
      panel — which is exactly the "it never learns where it is" rule made mechanical.

      THE SIDE COLUMN IS A FIXED 20rem and the create panel takes the rest. `1fr 1fr` gave a join
      form half the box: the two panels are not the same weight, and the settings are what needs
      the room. `minmax(0,…)` on the flexible track because a grid column's automatic minimum is
      min-content, which a long hint or a table code would push past — the same trap `min-h-0`
      exists for on the other axis.

      IT SPLITS AT `@2xl` AND NOT A RUNG HIGHER, which is a measurement rather than a taste. The
      modal's own body eats 3rem of padding, so a `lg` box (48rem — what a game with no stake and
      no house rule opens at) hands this 45rem: one rung up and every such table stacks its two
      panels forever, which is a taller page than the one this replaced. Measured in Chrome, that
      mistake made Tic-Tac-Toe's entrance 840px where it is 490 here.
    */
    <div className="@container">
      <div className="grid grid-cols-1 items-start gap-6 @2xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="p-4 @sm:p-6">
          {/*
            A CONTAINER OF ITS OWN, because the split below is about how wide the CARD is and the
            card is a fraction of the panel. Nested is the point: one query decides whether there
            are two panels, the other decides whether the create panel's controls sit in two
            columns, and neither can be phrased in terms of the other.
          */}
          <div className="@container flex flex-col gap-5">
            <h2 className={FIELDSET_LEGEND}>New table</h2>
            {/*
              THE CONTROLS, IN TWO COLUMNS WHEN THERE IS ROOM AND SOMETHING TO PUT IN BOTH.

              Column one is the TABLE — how many chairs, who may take one, what the other chairs
              play like. Column two is the GAME — what a chair costs and what rules it is played
              under. Stacked (a phone, a narrow lobby) they flatten to exactly that reading order,
              which is why the columns are two explicit stacks rather than grid auto-placement:
              auto-placement fills row-wise, so "Who can join" would land BESIDE "Players" on a
              wide screen and the pairing would change with the width.
            */}
            <div
              className={cx(
                'grid grid-cols-1 items-start gap-5',
                splitControls && '@xl:grid-cols-2'
              )}
            >
              <div className="flex flex-col gap-5">
                {/*
                  HOW MANY CHAIRS (v1's "PLAYERS 2 / 3 / 4"). Only drawn when the manifest's seat
                  range holds more than one size — see `tableSizeChoices`. Before this, `seats.min`
                  was decoration and every table was built at `max`, which is why sitting down to
                  UNO meant filling six CPU chairs whether or not you wanted them.
                */}
                {sizeChoices.length > 0 && (
                  <Fieldset
                    legend="Players"
                    hint={
                      // The count is a number and a number does not say who fills the chairs, which
                      // is the one thing that differs between the ways in. The preview beside it is
                      // the full answer; this is the sentence you read while still choosing.
                      fill === 'ai'
                        ? 'Every other chair is a bot. Start the moment the table opens.'
                        : fill === 'local'
                          ? 'Everyone plays from this screen, passing it round.'
                          : 'You take one chair; the rest stay open for other people.'
                    }
                  >
                    <div
                      className="flex flex-wrap gap-2"
                      role="group"
                      aria-label="How many players"
                    >
                      {sizeChoices.map((n) => (
                        <Button
                          key={n}
                          size="sm"
                          variant={n === seatCount ? 'secondary' : 'ghost'}
                          aria-pressed={n === seatCount}
                          onClick={() => {
                            setSeatCount(n);
                          }}
                        >
                          {n}
                        </Button>
                      ))}
                    </div>
                  </Fieldset>
                )}
                {/*
                  PUBLIC vs PRIVATE, chosen before the table exists (V1_FEATURE_GAPS #9). This is
                  the one control the room browser adds to the lobby, and it is here rather than
                  inside the room because a table that is briefly public is public: somebody can
                  already have joined by the time you change your mind. Public is the default —
                  that is what every table was before the browser, and a discovery surface nobody
                  appears on is worth nothing.

                  DIRECTLY UNDER "PLAYERS", which is where it belongs and is not where it was. It
                  used to be the LAST control in a single column of eight, below the house rules —
                  so on the one game that declares any, deciding whether strangers may walk into
                  your table meant scrolling past three paragraphs about drawing +2s. Seat count
                  and who may take a seat are one question asked twice; nothing else on the panel
                  is closer to it than the house rules were.

                  (It had no heading at all before that — a bare pair of pills reading "Listed /
                  Code only", which is the same invisibility the bot picker had and the same fix.)
                */}
                {mode === 'online' && (
                  <Fieldset
                    legend="Who can join"
                    hint={
                      visibility === 'public'
                        ? 'Listed in the room browser — anyone can walk up and take a chair.'
                        : 'Unlisted. Only people you send the table code to can join.'
                    }
                  >
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Who can join">
                      {(['public', 'private'] as const).map((v) => (
                        <Button
                          key={v}
                          size="sm"
                          variant={v === visibility ? 'secondary' : 'ghost'}
                          aria-pressed={v === visibility}
                          onClick={() => {
                            setVisibility(v);
                          }}
                        >
                          {v === 'public' ? 'Listed' : 'Code only'}
                        </Button>
                      ))}
                    </div>
                  </Fieldset>
                )}
                {/*
                  HOW THIS CLIENT PLAYS — the AI tier, and whatever else a game declares. Drawn
                  from `manifest.options` by the OS's one control, so a game never draws a picker; a
                  game with nothing declared renders nothing at all here.

                  It is a `<GameShell>` value rather than a room field, which is exactly right for
                  the only option any room game declares today (a tier read by the host, who drives
                  every bot) and exactly wrong for anything a GUEST must also read — that belongs in
                  room state, and it is named as a real change rather than a nuance in
                  `manifest.houseRules`.
                */}
                <GameOptions layout="panel" forMoney={backing === 'house'} />
              </div>

              {splitControls && (
                <div className="flex flex-col gap-5">
                  {/*
                    WHAT A CHAIR COSTS (v1's "ANTE: NONE / $25 / $100 / $500 / $1K"). Drawn only
                    when the game declares `betting` AND the ladder holds more than one stake —
                    `anteChoices` collapses to `[0]` otherwise, and a stake picker offering only
                    "None" is a control that cannot change the outcome.

                    ONLINE, or AI at a game the house will bank — the mirror of what `createTable`
                    sends. A visible ante on a table that can never pay one out is the same lie as
                    a visibility toggle on a table that is never listed, which is why this was
                    online-only until a lone player had a counterparty and a measured price.
                  */}
                  {showAnte && (
                    <Fieldset
                      legend="Ante"
                      hint={
                        /*
                WHAT THE STAKE BUYS, said before the table exists — and it is two different
                sentences, because there are two counterparties. A table of people plays for each
                other's money; a lone player plays the house, which funds the pot and prices it
                under fair odds. Neither sentence names a multiple: the odds are a rule of the GAME
                (the lobby must not learn one), and the exact pot is on the board the moment it is
                dealt.
              */
                        anteCents === 0 ? (
                          'Free table — the game still counts for XP and stats.'
                        ) : mode === 'ai' ? (
                          <>
                            You ante {formatMoney(anteCents)} against the house, which banks the
                            pot. The bots play their best and the odds are the house&rsquo;s — win
                            and it pays out, lose and it keeps the ante.
                          </>
                        ) : (
                          <>
                            Every player antes {formatMoney(anteCents)}; the winner takes the pot.{' '}
                            {houseBanks
                              ? 'One player against bots is banked by the house instead, at the house’s odds.'
                              : 'Needs two human players — otherwise the table plays for XP alone.'}
                          </>
                        )
                      }
                    >
                      <div
                        className="flex flex-wrap gap-2"
                        role="group"
                        aria-label="What a seat costs"
                      >
                        {anteOptions.map((cents) => {
                          // A rung is only "chosen" while nothing is typed. Otherwise a typed $25 would light
                          // the $25 button as well as filling the box, and un-typing it would leave two
                          // controls both claiming to be the answer.
                          const on = typedAnte === null && cents === rungCents;
                          return (
                            <Button
                              key={cents}
                              size="sm"
                              variant={on ? 'secondary' : 'ghost'}
                              aria-pressed={on}
                              onClick={() => {
                                setRungCents(cents);
                                setTypedAnte(null);
                              }}
                            >
                              {cents === 0 ? 'None' : formatMoney(cents)}
                            </Button>
                          );
                        })}
                        {/*
                THE RUNG LADDER IS A DEFAULT, NOT THE VOCABULARY. Six denominations are what you
                want when you do not care what the table costs; a field is what you want when you
                do, and "$25 or $100, nothing between" is the picker deciding something the people
                at the table are better placed to decide. The rungs stay because most tables never
                touch this — the button only OPENS the field, so nothing changes for anyone who
                does not press it.
              */}
                        <Button
                          size="sm"
                          variant={typedAnte !== null ? 'secondary' : 'ghost'}
                          aria-pressed={typedAnte !== null}
                          onClick={() => {
                            setTypedAnte(typedAnte === null ? '' : null);
                          }}
                        >
                          Custom
                        </Button>
                      </div>
                      {typedAnte !== null && (
                        <Input
                          label="Stake a seat"
                          // `inputMode` and not `type="number"`: a number input hands over spinner arrows, a
                          // scroll wheel that changes the value, and a browser-decided idea of what counts as
                          // a decimal. `parseAnte` is the one authority on what a stake may be, and it needs
                          // the string a person typed rather than one the field has already mangled.
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder={formatMoney(manifest.betting?.min ?? 0)}
                          value={typedAnte}
                          onChange={(e) => {
                            setTypedAnte(e.target.value);
                          }}
                          {...(anteError !== null ? { error: anteError } : {})}
                        />
                      )}
                    </Fieldset>
                  )}
                  {/*
                    HOUSE RULES (plans/done/UNO_HOUSE_RULES.md §1) — how this TABLE plays, as
                    opposed to `<GameOptions>` above, which is how one client does. Drawn only for
                    a game that declares any, so the panel is unchanged for the other five.

                    NOT online-only, unlike the ante and the visibility toggle. Those two are about
                    other people; a house rule is about the game, and a table of bots plays the
                    same game.

                    CREATE-TIME ONLY — there is no counterpart in the in-room view, and that is the
                    control doing its job rather than a gap in it: the rules are stamped on the
                    room and read by the referee at the deal, so a mid-lobby retune would change
                    the game under somebody who already took a chair. Same shape as the seat count
                    and the stake, same reason.
                  */}
                  {showRules && (
                    <Fieldset legend="House rules">
                      {/*
                        ONE BOXED ROW PER RULE, and the box is the whole point. This was a bare
                        column of left-aligned pills of three different widths, each trailed by a
                        full-width paragraph — so a toggle, a wrapped sentence, another toggle at a
                        different width, another sentence, with nothing saying which line belonged
                        to which control. Reading it meant re-deriving the pairing on every glance.
                        A border round each pair says it once.

                        A DISABLED DEPENDENT NAMES WHAT IT NEEDS. `isRuleAvailable` already refuses
                        to let "Cross-stacking" be pressed before "Stacking" is on, and drawing it
                        disabled rather than hidden was the right half of the decision (a control
                        that materialises out of nowhere reads as a bug) — but a greyed button with
                        no reason is a control that looks broken, which is the other half. The
                        prerequisite's own LABEL is quoted, so the sentence cannot name a rule id
                        or drift from what the button above it says.
                      */}
                      <div className="flex flex-col gap-2" role="group" aria-label="House rules">
                        {ruleSpecs.map((spec) => {
                          const on = isRuleOn(houseRules, spec.id);
                          const available = isRuleAvailable(houseRules, spec);
                          const needs = ruleSpecs.find((s) => s.id === spec.requires)?.label;
                          return (
                            <div
                              key={spec.id}
                              className="border-bw-line rounded-field flex flex-col gap-1.5 border p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  size="sm"
                                  variant={on ? 'secondary' : 'ghost'}
                                  aria-pressed={on}
                                  disabled={!available}
                                  onClick={() => {
                                    setHouseRules((prev) =>
                                      setTableRule(prev, ruleSpecs, spec.id, !on)
                                    );
                                  }}
                                >
                                  {on ? '✓ ' : ''}
                                  {spec.label}
                                </Button>
                                {!available && needs !== undefined && (
                                  <span className="text-bw-muted text-xs">Needs {needs}</span>
                                )}
                              </div>
                              {spec.hint !== undefined && (
                                <p className="text-bw-muted text-xs">{spec.hint}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </Fieldset>
                  )}
                </div>
              )}
            </div>
            {/*
              THE ONE LIT BUTTON, and it stays at the FULL WIDTH of the card below both columns
              rather than at the foot of one of them. Which column a create button belonged to is
              the ambiguity v1 apologised for by dimming half its panel to 30% opacity; a control
              that spans everything above it cannot be read as belonging to a part of it.
            */}
            <Button variant="primary" disabled={busy || anteError !== null} onClick={createTable}>
              Create table
            </Button>
          </div>
        </Card>

        <div className="flex flex-col gap-6">
          {/*
            THE TABLE YOU ARE ABOUT TO CREATE (§5.1) — v1's lobby preview, and the half of that
            screen worth keeping. It is the same `plannedSeats` array the create path uses, not a
            drawing of one, which is why a mode change redraws it (an AI table shows CPUs, an
            online one shows open chairs a stranger can take) with nothing in this component
            knowing what a mode is.

            IT MOVED OUT OF THE CREATE PANEL, and the adjacency argument it moved away from is
            worth restating rather than deleting: it used to sit directly above Create because that
            is the question it answers. On a wide screen it still does — it is the top of the
            column beside the panel, at the same eye level as the controls that decide it, where
            before it was the last thing in a column of eight and usually below the fold. What is
            genuinely given up is the narrow layout, where the columns stack and the preview lands
            after Create. That is a real cost and it buys a page you can read.
          */}
          <SeatPreview seats={planned} />

          {/*
            BOTH WAYS INTO SOMEBODY ELSE'S TABLE, and only in the mode that has one. An AI or
            hot-seat launch used to draw a room browser and a four-character code form as well —
            the entire right-hand half of the panel was about other people, on the two ways in
            whose whole point is that there are none. Nothing was broken; it just answered a
            question nobody had asked. Same reasoning as the visibility toggle being hidden here: a
            control that cannot change the outcome is worse than no control.
          */}
          {mode === 'online' && (
            <>
              {/* Renders nothing when no table of this game is open, so the panel is unchanged on
                  a quiet day and the code form below is still the way in. */}
              <RoomBrowser
                gameId={manifest.id}
                title="Open tables"
                onJoin={(_gameId, joinRoomId) => {
                  onEntered(joinRoomId);
                }}
              />

              <Card className="flex flex-col gap-4 p-4 @sm:p-6">
                <h2 className={FIELDSET_LEGEND}>Join a table</h2>
                <form
                  className="flex items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (code.trim() !== '') onEntered(code.trim().toUpperCase());
                  }}
                >
                  <Input
                    label="Table code"
                    placeholder="ABCD"
                    value={code}
                    maxLength={4}
                    onChange={(e) => {
                      setCode(e.target.value.toUpperCase());
                    }}
                    className="flex-1"
                  />
                  <Button type="submit" variant="secondary" disabled={code.trim() === ''}>
                    Join
                  </Button>
                </form>
                {/* Under the FORM, not as the field's `hint` — `Input` puts a hint inside its own
                    column, and the row is `items-end`, so the Join button would drop a line to
                    align with the sentence instead of with the box it submits. */}
                <p className="text-bw-muted text-xs">
                  Four letters, from whoever opened the table.
                </p>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
