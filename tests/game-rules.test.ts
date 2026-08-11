/**
 * THE IN-GAME RULES PANEL — what a table is playing, and what you have asked it to do for you.
 *
 * RENDERED, NOT GREPPED (`tests/modal.test.ts`'s trick, and `tests/uno-centre.test.ts`'s): the real
 * component goes through `renderToStaticMarkup` in Node, so what is asserted is the markup a
 * browser would be handed. There is no DOM, so the effects do not run — which is fine, because
 * every claim here is about what is DRAWN.
 *
 * Everything this panel can get wrong is silent. It cannot crash, it cannot move a chip, and it
 * renders beautifully in every failure mode below:
 *
 *  • **A rule that is OFF renders as nothing.** A list that only marks what is enabled reads as a
 *    list of everything there is, so "does this table stack?" gets answered wrongly by silence —
 *    which is worse than not having the panel, because the player believes they checked.
 *  • **A hint goes missing.** The hints ARE the feature: the header line already said which rules
 *    are on, and what it could never say is what any of them does. A panel that lists labels is
 *    the header line in a box.
 *  • **The two kinds get muddled.** They differ on who is bound and when they may change, and a
 *    panel that presented them alike would invite a player to flip a table-wide rule with the same
 *    click that flips a private one.
 *  • **It draws for a game with nothing to show** — the control that cannot change the outcome,
 *    which this OS refuses in `tableSizeChoices`, `anteChoices` and `houseRuleChoices` already.
 *
 * Plus the source-text half, `tests/game-result.test.ts`'s sibling: no GAME may draw one of these.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GameRules } from '@/system/game/GameRules';
import { registry } from '@/games/registry';
import { unoManifest } from '@/games/uno/manifest';
import { houseRuleChoices } from '@/system/room/houseRules';
import { playerPrefChoices } from '@/system/prefs/prefs';
import type { GameManifest } from '@/games/registry';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** The panel's markup with its dialog OPEN, which is the only state that draws anything. */
function draw(manifest: GameManifest, tableRules?: Record<string, boolean>): string {
  // `<Modal>` renders its children into a `<dialog>` regardless of `open` (the element is in the
  // DOM either way — `showModal()` is an effect, and effects do not run here). So the body is in
  // the markup and can be read, which is what makes this assertable at all without a browser.
  return renderToStaticMarkup(createElement(GameRules, { manifest, tableRules }));
}

/** Strip tags so a `toContain` cannot pass on an attribute or a class name. */
const text = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('the panel says what the TABLE agreed to', () => {
  it('names every declared house rule, on or off', () => {
    // Only `stack` is on. The other two must still appear — the failure this case exists for is a
    // list that renders the enabled rules and silently omits the rest.
    const out = text(draw(unoManifest, { stack: true }));
    for (const spec of houseRuleChoices(unoManifest.houseRules)) {
      expect(out, spec.id).toContain(spec.label);
    }
  });

  it('marks on and off differently, and gets each one right', () => {
    const html = draw(unoManifest, { stack: true });
    // The screen-reader labels are the machine-readable form of the same fact, so they are what is
    // asserted: the visible '✓ On' / 'Off' is one careless edit from being the only correct half.
    expect(html).toContain('on at this table');
    expect(html).toContain('off at this table');
    const on = (html.match(/on at this table/g) ?? []).length;
    const off = (html.match(/off at this table/g) ?? []).length;
    // Three declared rules, one of them on. Counted rather than merely present, because a panel
    // that marked everything 'On' contains both strings too.
    expect(on + off).toBe(houseRuleChoices(unoManifest.houseRules).length);
    expect(on).toBe(1);
  });

  /**
   * THE HINTS ARE THE FEATURE. The lobby header already renders "House rules: Stacking", so a panel
   * that added only labels would be that line in a box. What had no home anywhere on the page was
   * the sentence explaining what a rule DOES — it lives in the manifest and was drawn only on the
   * setup screen, which you leave in order to play.
   */
  it('carries each rule’s explanation, which is the thing the header line cannot say', () => {
    const out = text(draw(unoManifest, { stack: true }));
    for (const spec of houseRuleChoices(unoManifest.houseRules)) {
      if (spec.hint === undefined) continue;
      expect(out, spec.id).toContain(text(spec.hint).trim());
    }
  });

  it('reads an ABSENT bag as no rules rather than crashing', () => {
    // The deploy order: the frontend ships on push, the Pi by hand, so a new client will read a
    // snapshot from a referee that predates a field — and `undefined[id]` would take the header
    // down for every room game, not just this one.
    const out = text(draw(unoManifest));
    expect(out).toContain('Stacking');
    expect(draw(unoManifest)).not.toContain('on at this table');
  });
});

describe('the panel says what is YOURS, and says it is different', () => {
  it('draws a control for every declared preference, with its hint', () => {
    const out = text(draw(unoManifest, {}));
    for (const spec of playerPrefChoices(unoManifest.playerPrefs)) {
      expect(out, spec.id).toContain(spec.label);
      if (spec.hint !== undefined) expect(out, spec.id).toContain(text(spec.hint).trim());
    }
  });

  it('renders a preference as a PRESSABLE toggle and a house rule as a statement', () => {
    const html = draw(unoManifest, { stack: true });
    // `aria-pressed` is what makes a toggle a toggle to a screen reader, and it is also the honest
    // test of the difference in kind: exactly the preferences have it, and no house rule does.
    //
    // THIS IS THE GUEST'S PANEL — `draw` passes no writer, which is what read-only MEANS here
    // (plans/done/LIVE_HOUSE_RULES.md). The host's copy is the block below, and the two must not
    // converge: a guest shown a toggle the referee refuses is the UI that lies.
    expect((html.match(/aria-pressed/g) ?? []).length).toBe(
      playerPrefChoices(unoManifest.playerPrefs).length
    );
  });

  it('separates the two kinds by heading, so they cannot be read as one list', () => {
    const out = text(draw(unoManifest, {}));
    expect(out).toContain('This table');
    expect(out).toContain('Yours');
  });

  it('states that a preference is private and immediate — the two facts that define the kind', () => {
    const out = text(draw(unoManifest, {})).toLowerCase();
    expect(out).toContain('just for you');
    expect(out).toContain('straight away');
  });

  it('shows the DECLARED default when nothing has been stored', () => {
    // Auto-draw ships on, so a fresh reader must see it on. The '✓' prefix is how the button says
    // so; `aria-pressed="true"` is the same fact in the form a machine reads.
    expect(draw(unoManifest, {})).toContain('aria-pressed="true"');
  });
});

/**
 * THE HOST'S COPY — the half plans/done/LIVE_HOUSE_RULES.md added, and the half that can lie.
 *
 * Everything here renders beautifully when it is wrong, which is why it is asserted rather than
 * looked at. The three failures, in the order they would bite:
 *
 *  • **A GUEST is given toggles.** The referee refuses them (host-only, over the wire), so the
 *    control is dead on arrival — the exact "UI that lies" this slice was ordered around, and the
 *    reason PR #91 shipped the panel read-only in the first place.
 *  • **The panel claims a change is in force when it is NOT.** During a live round the room's rules
 *    and the round's differ for as long as a change is pending, and this panel reads the ROOM. An
 *    unqualified statement there is a lie about what game is being played, told to the person
 *    playing it. The fix is a time label, so it is a STRING — invisible to every other guard here.
 *  • **A dependent toggle is offered before its prerequisite.** The lobby draws it disabled rather
 *    than hidden, for the reason `houseRules.ts` states; a second drawing of the same toggles that
 *    reached a different answer would be two controls for one rule.
 */
describe('the host can change what the table plays, and the panel says when it lands', () => {
  const noop = (): Promise<{ ok: true; value: void }> =>
    Promise.resolve({ ok: true, value: undefined });

  /** The panel as the HOST sees it — a writer present is what "editable" means. */
  const drawHost = (tableRules: Record<string, boolean>, live = false): string =>
    renderToStaticMarkup(
      createElement(GameRules, { manifest: unoManifest, tableRules, live, onChangeRules: noop })
    );

  it('gives the HOST a pressable toggle per house rule, where a guest gets a statement', () => {
    const prefs = playerPrefChoices(unoManifest.playerPrefs).length;
    const rules = houseRuleChoices(unoManifest.houseRules).length;
    // The guest's count is the preferences alone; the host's is preferences PLUS every house rule.
    // Asserted as counts rather than "contains aria-pressed", because the guest's panel contains it
    // too — the preferences are pressable for everybody, and a substring check passes either way.
    expect((draw(unoManifest, { stack: true }).match(/aria-pressed/g) ?? []).length).toBe(prefs);
    expect((drawHost({ stack: true }).match(/aria-pressed/g) ?? []).length).toBe(prefs + rules);
  });

  it('tells the host a change lands NEXT DEAL, and never tells a guest that', () => {
    // A guest reading "your changes apply from the next deal" over controls they do not have is
    // a promise made to somebody who cannot act on it.
    expect(text(drawHost({})).toLowerCase()).toContain('next deal');
    expect(text(draw(unoManifest, {})).toLowerCase()).not.toContain('next deal');
  });

  it('says the ROUND IN PROGRESS keeps its own rules — but only while one is running', () => {
    // THE CORRECTNESS CASE. `live` is the one bit that separates "these are the rules" from "these
    // are the rules from now on", and the panel reads the room either way. Before a deal there is
    // no round to except, so the caveat must be ABSENT — a panel that always says it would be
    // hedging about a table where nothing has happened yet.
    expect(text(drawHost({ stack: true }, true)).toLowerCase()).toContain('round in progress');
    expect(text(drawHost({ stack: true }, false)).toLowerCase()).not.toContain('round in progress');
    // And it is the ROOM's bit, not the host's: a guest at a live table is told the same thing.
    expect(
      text(
        renderToStaticMarkup(
          createElement(GameRules, { manifest: unoManifest, tableRules: {}, live: true })
        )
      ).toLowerCase()
    ).toContain('round in progress');
  });

  it('draws a dependent rule DISABLED until its prerequisite is on, rather than hiding it', () => {
    const dependent = houseRuleChoices(unoManifest.houseRules).find(
      (s) => s.requires !== undefined
    );
    // Read off the real manifest, and asserted to EXIST — the day UNO stops declaring a dependent
    // rule this case would otherwise pass by testing nothing.
    expect(dependent, 'UNO declares a rule with a prerequisite').toBeDefined();
    if (dependent === undefined) return;
    // Off: still listed (so the relationship is visible), and not operable.
    const without = drawHost({});
    expect(text(without)).toContain(dependent.label);
    expect(without).toContain('disabled');
    // On: the same toggle, now live. Asserted by the DISABLED count falling, since the panel also
    // disables nothing else in this state.
    const withParent = drawHost({ [dependent.requires ?? '']: true });
    expect((withParent.match(/disabled/g) ?? []).length).toBeLessThan(
      (without.match(/disabled/g) ?? []).length
    );
  });
});

describe('a game with nothing to show gets no button', () => {
  it('renders nothing at all when neither kind is declared', () => {
    const bare = registry.find(
      ({ manifest }) =>
        houseRuleChoices(manifest.houseRules).length === 0 &&
        playerPrefChoices(manifest.playerPrefs).length === 0
    );
    // Read off the REAL registry, and asserted to EXIST — otherwise the case passes vacuously the
    // day every game declares something.
    expect(bare, 'no registered game declares neither kind').toBeDefined();
    if (bare) expect(draw(bare.manifest)).toBe('');
  });

  it('draws a button for every game that declares either kind', () => {
    let sawOne = false;
    for (const { manifest } of registry) {
      const declares =
        houseRuleChoices(manifest.houseRules).length > 0 ||
        playerPrefChoices(manifest.playerPrefs).length > 0;
      if (!declares) continue;
      sawOne = true;
      expect(draw(manifest), manifest.id).toContain('Rules');
    }
    expect(sawOne).toBe(true);
  });
});

/**
 * THE SOURCE-TEXT HALF — `tests/game-result.test.ts`'s and `tests/game-exit.test.ts`'s sibling, and
 * for their reason: the OS decides WHERE this goes, so a game that drew its own would put a second
 * one somewhere else, and there is no DOM here to notice that.
 */
describe('no game draws its own rules panel', () => {
  function sourcesUnder(dir: string): [string, string][] {
    const out: [string, string][] = [];
    for (const entry of readdirSync(dir)) {
      const full = `${dir}/${entry}`;
      if (statSync(full).isDirectory()) out.push(...sourcesUnder(full));
      else if (entry.endsWith('.ts') || entry.endsWith('.tsx'))
        out.push([full.slice(SRC.length), readFileSync(full, 'utf8')]);
    }
    return out;
  }

  // Comments are stripped first — `tests/table-sidebar.test.ts`'s lesson: every file here explains
  // the defect by naming the thing that caused it, and a guard that goes red on the documentation
  // of the bug it prevents is one somebody deletes.
  const strip = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

  it('is rendered by the OS alone', () => {
    const drawn = sourcesUnder(`${SRC}games`)
      .filter(([, src]) => strip(src).includes('<GameRules'))
      .map(([path]) => path);
    expect(drawn).toEqual([]);
  });

  it('is rendered by the lobby, so a table that declares something actually gets it', () => {
    // The other direction, and the one that would otherwise pass forever: a panel nobody mounts
    // satisfies every case above, because they all call the component directly.
    const lobby = readFileSync(`${SRC}system/room/Lobby.tsx`, 'utf8');
    expect(strip(lobby)).toContain('<GameRules');
  });

  /**
   * ONLY THE HOST IS HANDED THE WRITER. Every rendered case above calls the component directly, so
   * all of them stay green if the lobby passes `onChangeRules` unconditionally — and the result is
   * a guest clicking toggles the referee refuses, which is precisely what the read-only panel
   * existed to avoid. There is no DOM here, so "the guest sees no toggle" is not assertable at the
   * lobby; that the writer is GATED is, and it has one spelling.
   */
  it('hands the writer to the HOST alone', () => {
    const lobby = strip(readFileSync(`${SRC}system/room/Lobby.tsx`, 'utf8'));
    const passes = lobby.includes('onChangeRules');
    // Gated on `isHost` in the same expression that passes it — not merely mentioned somewhere in
    // a 400-line file, which a `&&` two components away would also satisfy.
    const gated = /isHost\s*\?[^}]*onChangeRules|onChangeRules[^}]*isHost\s*\?/.test(lobby);
    expect(passes && gated, 'Lobby must pass onChangeRules only when isHost').toBe(true);
  });
});
