import { useState } from 'react';
import { Button, Modal, cx } from '@/ui';
import type { GameManifest } from '@/games/registry';
import {
  houseRuleChoices,
  isRuleAvailable,
  isRuleOn,
  setTableRule,
  tableRulesFor,
  NO_TABLE_RULES,
  type HouseRuleSpec,
  type TableRules,
} from '@/system/room/houseRules';
import type { RepoResult } from '@/system/repo/types';
import { playerPrefChoices, type PlayerPrefSpec } from '@/system/prefs/prefs';
import { usePlayerPref, setPlayerPref } from '@/system/prefs/prefsStore';

/**
 * `<GameRules>` — WHAT THIS TABLE IS PLAYING, AND WHAT YOU HAVE ASKED IT TO DO FOR YOU. One
 * button, in the header, drawn by the OS for any game that declares either kind.
 *
 * WHY IT EXISTS. Both of these facts were reachable only BEFORE the deal. House rules are picked in
 * the setup panel and then summarised as a line of labels in the header — "House rules: Stacking" —
 * which tells you a rule is on and nothing about what it does; the sentence explaining it lives in
 * the manifest and was only ever rendered on the entrance, on a screen you leave to start playing.
 * So "can a +4 answer a +2 at this table?" is a question with no answer anywhere on the page at the
 * exact moment somebody plays one. And a preference had no home at all, because this is the first
 * one to exist.
 *
 * THE PANEL DRAWS THE TWO KINDS SEPARATELY, and that is the whole design rather than a layout
 * choice. They differ on the two questions `prefs.ts` sets out — who is bound, and when it may
 * change — and a panel that mixed them would be inviting a player to flip a table-wide rule with
 * the same click that flips a private one. So: THIS TABLE is a statement, YOURS is a set of
 * controls, and the difference in kind is visible before anything is read.
 *
 * THE HOUSE RULES ARE THE HOST'S TO CHANGE, AND THEY LAND AT THE NEXT DEAL
 * (plans/done/LIVE_HOUSE_RULES.md). This panel shipped read-only, because the referee had no frame
 * for it and drawing a toggle it would refuse is the UI that lies. It has one now.
 *
 * HOST-ONLY, which is a fairness call rather than a convenience: the invariant write-once protected
 * is "the game you are playing right now cannot change beneath you", and that is kept by `deal`
 * stamping the rules onto the MATCH — no room-level write can reach a round in flight. Guests never
 * had a vote on the rules at create (they consent by sitting down at a table whose rules are on the
 * listing), so requiring one here would invent a power in order to defend an invariant that is not
 * under threat. The deal that carries the change already needs everyone: `<Rematch>` is unanimous.
 *
 * WHICH IS WHY THE TIME LABEL IS LOAD-BEARING AND NOT COPY. While a round is live, the ROOM's rules
 * and the ROUND's differ for exactly as long as a change is pending — and this panel reads the room.
 * Stating that set as though it were in force would be a UI that lies in the ordinary way. The OS
 * cannot read the match's rules (`state` is `unknown` to it, and must stay so) and does not need to:
 * it distinguishes them by TIME. `live` says a round is in flight, and the panel then says the set
 * applies from the next deal and that the round in progress keeps what it was dealt with — true
 * without the OS knowing one thing about UNO.
 *
 * IT IS THE KIT'S ONE `<Modal>`, for `<GameResult>`'s reason: a board's felt is `overflow-hidden`
 * and `isolate`, so anything in flow can be clipped or lose a z-index fight, and a native
 * `<dialog>` in the top layer cannot.
 *
 * IT RENDERS NOTHING when a game declares neither kind — five of the six today. A button that
 * opens an empty panel is the control-that-cannot-change-the-outcome this OS refuses everywhere
 * else (`tableSizeChoices`, `anteChoices`, `houseRuleChoices`).
 */
export interface GameRulesProps {
  /** The game whose declarations are drawn. `houseRules` and `playerPrefs` are read off it. */
  readonly manifest: GameManifest;
  /**
   * What the ROOM agreed to, off the room's own meta — never the game's projection.
   *
   * Optional and tolerant of `undefined` for `isRuleOn`'s reason: the frontend deploys on push and
   * the Pi by hand, so a new client will read snapshots from a referee that predates a field, and
   * an absent bag means "no rules" rather than a crash. It is also genuinely absent before a table
   * exists.
   *
   * `| undefined` is spelled out rather than left to `?`, because `exactOptionalPropertyTypes` is
   * on and the caller passes `meta?.houseRules` — an expression that IS `undefined` before the room
   * snapshot lands. Making the absence unspellable at the type level would only push a `??` into
   * the lobby, where it would have to invent a default for a bag it must not interpret.
   */
  readonly tableRules?: TableRules | undefined;
  /**
   * WRITE THE TABLE'S RULES, or `undefined` for a reader who may not — which is every guest, and
   * every context with no room at all. Absence is what makes the panel read-only, so a client that
   * cannot honour a click never draws one.
   *
   * It is a PROP rather than a `useRoom()` call inside this component, deliberately: `<GameRules>`
   * also has to render for a solo game that mounts no `<RoomProvider>`, and a hook that throws
   * outside a room would make the panel a room-only surface. The lobby holds the room; this holds
   * the manifest.
   */
  readonly onChangeRules?: ((rules: TableRules) => Promise<RepoResult<void>>) | undefined;
  /**
   * IS A ROUND IN FLIGHT? The one bit that decides whether the set on screen is in force or merely
   * next — see the note above about why that is a correctness property and not copy. Defaults to
   * `false`, the honest reading for any caller with no room: nothing is being played, so the rules
   * shown are simply the rules.
   */
  readonly live?: boolean;
}

export function GameRules({ manifest, tableRules, onChangeRules, live = false }: GameRulesProps) {
  const [open, setOpen] = useState(false);
  const ruleSpecs = houseRuleChoices(manifest.houseRules);
  const prefSpecs = playerPrefChoices(manifest.playerPrefs);

  if (ruleSpecs.length === 0 && prefSpecs.length === 0) return null;

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {/* The label names the CONTENT, not the action — "Settings" would be a promise about the
            app, and this is a panel about one table and one game. */}
        Rules
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`${manifest.name} — rules`}
        size="md"
      >
        <div className="flex flex-col gap-6">
          {ruleSpecs.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="font-display text-base-content text-xs font-semibold tracking-[0.18em] uppercase">
                This table
              </h3>
              {/* Binding on everybody at the table, so this states WHEN it applies before it lists
                  anything. A host reading "everyone here plays under the same set" over a control
                  they can operate mid-round would reasonably expect the click to land now. */}
              <p className="text-bw-muted text-xs">
                {live
                  ? 'Everyone here plays under the same set. The round in progress keeps the rules it was dealt with.'
                  : 'Everyone here plays under the same set.'}
                {onChangeRules !== undefined && ' Your changes apply from the next deal.'}
              </p>
              {onChangeRules === undefined ? (
                <ul className="flex flex-col gap-2">
                  {ruleSpecs.map((spec) => {
                    const on = isRuleOn(tableRules, spec.id);
                    return (
                      <li
                        key={spec.id}
                        className="border-bw-line rounded-field flex flex-col gap-1 border p-3"
                      >
                        <div className="flex items-center gap-2">
                          {/* OFF is drawn as loudly as ON. A list that only marks what is enabled
                              reads as a list of everything there is, so a rule that is off looks
                              like a rule that does not exist — and "does this table stack?" is
                              answered wrongly by silence. */}
                          <span
                            className={cx(
                              'font-display text-[0.6rem] font-semibold tracking-[0.14em] uppercase',
                              on ? 'text-secondary' : 'text-bw-muted'
                            )}
                            aria-label={on ? 'on at this table' : 'off at this table'}
                          >
                            {on ? '✓ On' : 'Off'}
                          </span>
                          <span className="text-base-content text-sm font-semibold">
                            {spec.label}
                          </span>
                        </div>
                        {spec.hint !== undefined && (
                          <p className="text-bw-muted text-xs">{spec.hint}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <TableRuleToggles
                  specs={ruleSpecs}
                  values={tableRules}
                  onChangeRules={onChangeRules}
                />
              )}
            </section>
          )}

          {prefSpecs.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="font-display text-base-content text-xs font-semibold tracking-[0.18em] uppercase">
                Yours
              </h3>
              {/* The two sentences that make the kind legible: it is private, and it is immediate.
                  Both are the opposite of the section above, which is the point of saying them. */}
              <p className="text-bw-muted text-xs">
                Just for you, on this device. Changes apply straight away — nobody else is affected.
              </p>
              <div className="flex flex-col gap-2" role="group" aria-label="Your preferences">
                {prefSpecs.map((spec) => (
                  <PrefRow key={spec.id} gameId={manifest.id} spec={spec} />
                ))}
              </div>
            </section>
          )}
        </div>
      </Modal>
    </>
  );
}

/**
 * THE HOST'S COPY OF THE TABLE'S RULES — the same list the guest reads, with the statements turned
 * into controls.
 *
 * IT HOLDS NO COPY OF THE VALUES. Every toggle reads `values`, which comes off the room snapshot,
 * and a click sends the whole next bag and waits for that snapshot to come back changed. Mirroring
 * the bag into local state would be the second source of truth this OS keeps deleting — and it would
 * be the visible kind, because the referee sanitises what it stores: a rule the server dropped would
 * stay lit here forever, which is a lobby disagreeing with the dealer about what game is being
 * played. The cost is that a toggle moves a round trip late rather than instantly; on a control this
 * consequential, showing only what the table actually agreed to is the right trade.
 *
 * IT USES THE LOBBY'S OWN `setTableRule`, so the prerequisite cascade is the same lines of code in
 * both places — un-ticking "stacking" clears "+4 onto a +2" here exactly as it does at create,
 * rather than leaving a dependent set in a bag the resolver then has to normalise away.
 */
function TableRuleToggles({
  specs,
  values,
  onChangeRules,
}: {
  readonly specs: readonly HouseRuleSpec[];
  readonly values: TableRules | undefined;
  readonly onChangeRules: (rules: TableRules) => Promise<RepoResult<void>>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = values ?? NO_TABLE_RULES;

  const toggle = (spec: HouseRuleSpec): void => {
    const next = setTableRule(current, specs, spec.id, !isRuleOn(current, spec.id));
    // `setTableRule` hands back the SAME object when nothing changed — an unavailable dependent, or
    // a click that asked for the state it is already in. Sending that would be a wire round trip
    // for a no-op.
    if (next === current) return;
    setBusy(true);
    setError(null);
    void onChangeRules(tableRulesFor(next, specs))
      .then((res) => {
        // A refusal is ORDINARY here, not exceptional: the table may have closed, or the referee
        // may predate the frame during the window the Pi-first deploy order exists to keep short.
        // Said out loud, because the toggle will visibly not have moved and an unexplained dead
        // control is worse than an error.
        if (!res.ok) setError(res.error);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Could not change the rules.');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className="flex flex-col gap-2" role="group" aria-label="House rules">
      {specs.map((spec) => {
        const on = isRuleOn(current, spec.id);
        // A dependent whose prerequisite is off is drawn DISABLED rather than hidden, so the
        // relationship is visible — the lobby's own rule, arriving at the second place that draws
        // these toggles. One appearing out of nowhere the moment you tick its parent reads as a bug.
        const available = isRuleAvailable(current, spec);
        return (
          <div
            key={spec.id}
            className="border-bw-line rounded-field flex flex-col items-start gap-1.5 border p-3"
          >
            <Button
              size="sm"
              variant={on ? 'secondary' : 'ghost'}
              aria-pressed={on}
              disabled={busy || !available}
              onClick={() => {
                toggle(spec);
              }}
            >
              {on ? '✓ ' : ''}
              {spec.label}
            </Button>
            {spec.hint !== undefined && <p className="text-bw-muted text-xs">{spec.hint}</p>}
            {!available && spec.requires !== undefined && (
              <p className="text-bw-muted text-xs">
                Needs {specs.find((s) => s.id === spec.requires)?.label ?? spec.requires}.
              </p>
            )}
          </div>
        );
      })}
      {error !== null && <p className="text-error text-xs">{error}</p>}
    </div>
  );
}

/**
 * ONE PREFERENCE ROW — its own component because `usePlayerPref` is a hook and the list is a map.
 * Calling a hook per item inside the parent's `.map` is the rules-of-hooks violation that only
 * breaks once a game declares a second preference and the count changes between renders.
 */
function PrefRow({ gameId, spec }: { readonly gameId: string; readonly spec: PlayerPrefSpec }) {
  const on = usePlayerPref(gameId, spec);
  return (
    // `items-start` is not tidying: a flex COLUMN stretches its children, so without it the toggle
    // runs the full width of the dialog and reads as the panel's primary action — the shape a
    // "Save" or a "Deal" has — rather than as a switch. The lobby's own house-rule toggles are
    // content-width for the same reason, and this is the only other place in the app that draws
    // one, so the two must not look like different kinds of control. Found in a screenshot; no
    // assertion here can see it.
    <div className="border-bw-line rounded-field flex flex-col items-start gap-1.5 border p-3">
      <Button
        size="sm"
        variant={on ? 'secondary' : 'ghost'}
        aria-pressed={on}
        onClick={() => {
          setPlayerPref(gameId, spec.id, !on);
        }}
      >
        {on ? '✓ ' : ''}
        {spec.label}
      </Button>
      {spec.hint !== undefined && <p className="text-bw-muted text-xs">{spec.hint}</p>}
    </div>
  );
}
