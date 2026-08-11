import { useState } from 'react';
import { Button, Modal, cx } from '@/ui';
import type { GameManifest } from '@/games/registry';
import { houseRuleChoices, isRuleOn, type TableRules } from '@/system/room/houseRules';
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
 * WHY THE HOUSE RULES ARE READ-ONLY HERE, said plainly rather than papered over. They are stamped
 * on the room at create and **write-once thereafter** — `boardwalk-api` enforces that across
 * seats/status/state/presence, and the property it buys is that nobody changes what game a table is
 * playing under a player who already sat down. Making them editable mid-table is a real change: a
 * new wire frame, a relaxation of that write-once guard, and a hand deploy to the Pi before any
 * client may draw the control. Drawing an editable toggle here first would be a control the referee
 * refuses — the UI that lies, which this repo has now shipped twice and caught twice. So the panel
 * states what the table agreed to, and the toggles land in the slice that can honour them.
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
}

export function GameRules({ manifest, tableRules }: GameRulesProps) {
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
              {/* Set when the table was made, and binding on everybody at it — so this is a
                  statement of fact, and the copy says where it was decided rather than leaving a
                  reader to wonder why there is nothing to press. */}
              <p className="text-bw-muted text-xs">
                Chosen when the table was created. Everyone here plays under the same set.
              </p>
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
