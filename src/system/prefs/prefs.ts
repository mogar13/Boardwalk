/**
 * A PLAYER PREFERENCE — the third kind of thing a game can be played differently under, and the
 * one nobody else at the table is bound by.
 *
 * There are now three, and they are told apart by TWO questions: **who is bound by it**, and
 * **when may it change**. Getting a value into the wrong one is not a style mistake — each wrong
 * pairing has its own failure, and all three have already happened in this repo or in v1:
 *
 * | kind          | who is bound   | when it may change      | where it lives          |
 * |---------------|----------------|-------------------------|-------------------------|
 * | `options`     | you            | before the game starts  | the URL (`?o.<id>=`)    |
 * | `houseRules`  | the whole table| at create               | room state, the referee |
 * | `playerPrefs` | you            | ANY TIME, instantly     | this module, per device |
 *
 * WHY THIS IS NOT AN `option`. The options seam is per-client already, which makes it look like the
 * obvious home — and its stated rule is the reason it is the wrong one: "an option change is a NEW
 * GAME, not a mutation of one in flight" (Solitaire re-deals; v1's Chess deferred a difficulty
 * change to the next game). That is right for a rule that changes how the game PLAYS and fatal for
 * a preference about how your own client operates the controls: nobody wants their UNO hand
 * re-dealt because they turned an auto-draw off. An options value also lives in the URL, which is
 * a *link* — and a link is a thing you share, so a preference living there would arrive at whoever
 * you sent the table to.
 *
 * WHY IT IS NOT A HOUSE RULE. A house rule changes what game is being played, so every seat is
 * bound by it, so it is room state the referee enforces and it may not move under a round in
 * progress. A preference changes NOTHING about the game — the same moves are legal, the same
 * moves are refused, and the position after your turn is identical either way. There is therefore
 * nothing to agree about and nothing to be fair about, which is exactly why it may be instant.
 *
 * **THAT IS THE TEST, and it is the one to apply to the next candidate:** if turning it off could
 * change what the rules permit, or what anybody else sees, it is not a preference. UNO's auto-draw
 * passes cleanly — it fires only in the position where `applyMove` refuses every play and accepts
 * exactly one action, so the click it saves you was never a decision. A "peek at the next card"
 * toggle would fail it, and so would "play my turn for me".
 *
 * This module is PURE. The storage and the React store are `prefsStore.ts`, the same split
 * `sounds.ts`/`audioStore.ts` and `felts.ts`/`useEquippedFelt.ts` already make.
 */

/**
 * ONE TOGGLE A GAME OFFERS ITS OWN PLAYER — manifest DATA, so the OS draws the control and the
 * game never does. `HouseRuleSpec`'s sibling, and deliberately near-identical in shape, because a
 * player reading the two lists in one modal should not be able to tell which one the programmer
 * found more interesting.
 *
 * THE ONE FIELD `HouseRuleSpec` HAS NOT GOT IS `default`, and its absence there is a rule: every
 * house rule is OFF unless a table says otherwise, because an on-by-default house rule silently
 * retunes the game for everyone who does not read the lobby. A preference is the opposite case —
 * it describes behaviour a game ALREADY HAS, and auto-draw has been on since the day it shipped.
 * Defaulting it off would turn a live feature off under every existing player, which is the same
 * defect pointing the other way. So a spec must say what the game does today, and
 * `tests/player-prefs.test.ts` asserts each declared default is the behaviour that shipped.
 */
export interface PlayerPrefSpec {
  /** Unique within a game. Namespaced by game id in storage, so two games may both use `autoDraw`. */
  readonly id: string;
  /** The toggle's label. */
  readonly label: string;
  /** One line under it — what turning it off actually does at the table. */
  readonly hint?: string;
  /** What the game does with nothing stored. MUST be the behaviour that already ships. */
  readonly default: boolean;
}

/** The prefix every stored preference shares. Public so the store can sweep for its own keys. */
export const PREF_KEY_PREFIX = 'boardwalk_pref';

/**
 * Where one preference is stored, namespaced by GAME.
 *
 * The namespace is not tidiness. `autoDraw` is a name a second game will plausibly want (a
 * dominoes hand with nothing to play is the identical position), and two games sharing one key
 * means turning it off in one turns it off in the other — which reads as the setting leaking
 * rather than as a collision, and is invisible until somebody owns both games' toggles.
 */
export function prefKey(gameId: string, prefId: string): string {
  return `${PREF_KEY_PREFIX}_${gameId}_${prefId}`;
}

/**
 * Read one stored string as a preference, falling back to the spec's default.
 *
 * ONLY THE TWO LITERALS COUNT. `localStorage` is user-editable text — the same untrusted-input
 * posture `readOptionValues` takes with the query string and `resolveHouseRules` takes with the
 * wire — so `'1'`, `'yes'`, `''` and `null` all resolve to the default rather than being coerced.
 * The failure this prevents is quiet: `Boolean('false')` is `true`, so the obvious coercion turns
 * every explicitly-disabled preference back on the moment it round-trips through storage.
 */
export function resolvePref(stored: string | null | undefined, spec: PlayerPrefSpec): boolean {
  if (stored === 'true') return true;
  if (stored === 'false') return false;
  return spec.default;
}

/**
 * The toggles to draw for a game, or `[]` for one that declares none — which every surface reads
 * as "draw nothing", the `houseRuleChoices`/`tableSizeChoices`/`anteChoices` convention. A control
 * that cannot change the outcome is worse than no control.
 *
 * Unlike `houseRuleChoices` there is no `requires` to filter on, and that is deliberate rather
 * than not-yet-built: a prerequisite between two preferences would be a relationship between two
 * facts about ONE player's client, which is a thing to collapse into a single toggle rather than
 * to model.
 */
export function playerPrefChoices(specs?: readonly PlayerPrefSpec[]): readonly PlayerPrefSpec[] {
  return specs ?? [];
}
