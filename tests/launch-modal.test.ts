/**
 * THE ENTRANCE, as far as a test without a DOM can reach it (plans/done/GAME_LAUNCH_MODAL.md §9).
 *
 * `<GameLaunchModal>` renders what these functions return and holds no second opinion, which is
 * what makes them the right thing to assert — the same split `plannedSeats`/`<SeatPreview>` and
 * `opponentSlots`/UNO's board already use. Everything here is swept over the REAL registry rather
 * than a fixture, because every failure below is a property of the games this app ships and none
 * of them is visible in the file that causes it:
 *
 *   • a mode with no label renders a button with nothing written on it;
 *   • two modes sharing a label render two buttons a player cannot tell apart;
 *   • a game whose only mode is solo, with options, navigating on the click skips the one screen
 *     that would have let it be configured;
 *   • a modifier-click swallowed by the modal silently costs "open in new tab" — the loss nobody
 *     files a bug about.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { GameLaunchModal } from '@/shell/GameLaunchModal';
import { registry, type GameManifest, type RegisteredGame } from '@/games/registry';
import { MODE_HINT, MODE_LABEL, roomModesOf, type GameMode } from '@/system/room/modes';
import {
  isPlainClick,
  isRoomMode,
  launchModes,
  launchStepFor,
  launchWidthFor,
  playPath,
} from '@/shell/launch';
import { MODAL_WIDTH } from '@/ui/Modal';
import { readOptionValues } from '@/system/options/optionParams';
import { defaultOptionValues, NO_OPTIONS } from '@/system/options/options';

const ALL_MODES: GameMode[] = ['solo', 'ai', 'hotseat', 'online'];

describe('the mode step lists exactly what the manifest declares', () => {
  it('offers every mode, in order, for every registered game', () => {
    for (const { manifest } of registry) {
      expect(
        launchModes(manifest).map((m) => m.mode),
        `${manifest.id}: the ways in are not the manifest's`
      ).toEqual([...manifest.modes]);
    }
  });

  it('labels every one of them — an unlabelled mode is an empty button', () => {
    for (const { manifest } of registry) {
      for (const { mode, label } of launchModes(manifest)) {
        expect(label.trim(), `${manifest.id}/${mode}: no label`).not.toBe('');
        expect(label, `${manifest.id}/${mode}: label is the raw enum member`).not.toBe(mode);
      }
    }
  });

  it('gives every mode its OWN label', () => {
    // Two ways in reading the same word is a picker that cannot be used, and no type can see it —
    // `Record<GameMode, string>` is satisfied by four copies of "Play".
    const labels = ALL_MODES.map((mode) => MODE_LABEL[mode]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('gives every game a modal, including the ones with a single way in', () => {
    // Decision 3, as an assertion: the modal is the ENTRANCE to a game, not a picker, so a game
    // with one way in shows one way in rather than being special-cased out of the flow.
    for (const { manifest } of registry) {
      expect(launchModes(manifest).length, `${manifest.id}: no way in at all`).toBeGreaterThan(0);
    }
    const single = registry.filter((g) => g.manifest.modes.length === 1);
    expect(single.length, 'no single-mode game left to prove the point on').toBeGreaterThan(0);
  });

  it('hints at what a way in DOES, wherever it hints at all', () => {
    for (const mode of ALL_MODES) {
      const hint = MODE_HINT[mode];
      if (hint === undefined) continue;
      expect(hint.trim(), `${mode}: empty hint`).not.toBe('');
    }
    // `solo` deliberately has none: a sentence explaining the only button on the screen is
    // furniture. Pinned so that adding one is a decision rather than a reflex.
    expect(MODE_HINT.solo).toBeUndefined();
  });
});

describe('roomModesOf — which ways in mean a room', () => {
  it('drops solo and keeps the rest in order', () => {
    expect(roomModesOf(['solo', 'ai', 'online'])).toEqual(['ai', 'online']);
    expect(roomModesOf(['solo'])).toEqual([]);
    expect(roomModesOf(['online', 'hotseat'])).toEqual(['online', 'hotseat']);
  });

  it('agrees with `isRoomMode`, since they are one rule', () => {
    expect(ALL_MODES.filter(isRoomMode)).toEqual(roomModesOf(ALL_MODES));
  });
});

describe('launchStepFor — what a mode has to ask before the game starts', () => {
  it('always asks for a table on a room mode', () => {
    for (const { manifest } of registry) {
      for (const mode of roomModesOf(manifest.modes)) {
        expect(launchStepFor(manifest, mode), `${manifest.id}/${mode}`).toBe('table');
      }
    }
  });

  it('asks a solo game only what it declares, and nothing when it declares nothing', () => {
    // §6's table, read off the real manifests: Solitaire's draw count is a step, Blackjack's
    // (empty) setup is not — and the difference must come from the manifest rather than a list of
    // game ids here, so Blackjack's depth landing later needs no edit to this file.
    for (const { manifest } of registry) {
      if (!manifest.modes.includes('solo')) continue;
      const declared = (manifest.options ?? NO_OPTIONS).length > 0;
      expect(launchStepFor(manifest, 'solo'), `${manifest.id}`).toBe(declared ? 'options' : 'none');
    }
  });

  it('covers both answers on the registry as it stands', () => {
    // Otherwise the case above passes vacuously the day every solo game declares options — or
    // none of them does.
    const solo = registry.filter((g) => g.manifest.modes.includes('solo'));
    const steps = new Set(solo.map((g) => launchStepFor(g.manifest, 'solo')));
    expect(steps).toEqual(new Set(['options', 'none']));
  });
});

describe('launchWidthFor — how wide the entrance opens', () => {
  it('answers with a rung the kit actually has', () => {
    // A width that is not a `MODAL_WIDTH` key is a `size` prop that indexes to `undefined`, which
    // Tailwind answers by generating nothing: the box silently keeps the width it already had.
    // Typed today, asserted anyway, because the rungs are a plain object and the failure is silent.
    const rungs = new Set(Object.keys(MODAL_WIDTH));
    expect(launchWidthFor(registry[0]?.manifest as GameManifest, null)).toBe('sm');
    for (const { manifest } of registry)
      for (const mode of manifest.modes)
        expect(rungs.has(launchWidthFor(manifest, mode)), `${manifest.id}/${mode}`).toBe(true);
  });

  it('never opens a TABLE narrower than the width every setup step already had', () => {
    // The regression that would be invisible: a table step at `sm`/`md` puts eight controls in a
    // 32rem box, which is the "form you scroll" this whole seam exists to have fixed. A room mode
    // may only go WIDER than the `lg` it shipped at, never narrower.
    for (const { manifest } of registry)
      for (const mode of roomModesOf(manifest.modes))
        expect([`lg`, `xl`], `${manifest.id}/${mode}`).toContain(launchWidthFor(manifest, mode));
  });

  it('reaches BOTH table widths on the registry as it stands', () => {
    // `launchStepFor`'s rule one door along, and for the same reason: a branch no registered game
    // takes is a branch nobody has looked at. `xl` is the two-column panel (UNO's stake and house
    // rules), `lg` the one-column one (Chess hot-seat is a heading and a Create button — at `xl`
    // that is a 1280px box holding one button, which reads as a panel that failed to load).
    const widths = new Set(
      registry.flatMap(({ manifest }) =>
        roomModesOf(manifest.modes).map((mode) => launchWidthFor(manifest, mode))
      )
    );
    expect(widths).toEqual(new Set(['lg', 'xl']));
  });

  it('gives a SOLO step a dialog, never a panel', () => {
    // Solitaire's step is two segmented rows and Deal me in. It rode at the table's width for one
    // afternoon, and 48rem of empty box around three buttons is the same failure as a table that
    // is too narrow, pointing the other way.
    for (const { manifest } of registry)
      if (manifest.modes.includes('solo')) expect(launchWidthFor(manifest, 'solo')).toBe('md');
  });
});

describe('playPath — where a launch lands', () => {
  it('carries the table and the mode a room launch needs', () => {
    expect(playPath({ gameId: 'uno', mode: 'ai', table: 'ABCD', options: {} })).toBe(
      '/play/uno?table=ABCD&mode=ai'
    );
  });

  it('carries the chosen options, and they survive the round trip', () => {
    // The whole reason the values ride in the URL: they are chosen on the HUB and read by a game
    // the play route mounts one navigation later. A path that carried them in a shape
    // `readOptionValues` could not read back would lose the tier silently, and it would look
    // exactly like the default being right.
    for (const { manifest } of registry) {
      const spec = manifest.options ?? NO_OPTIONS;
      if (spec.length === 0) continue;
      // The LAST choice of every option, so a value that happens to be the default cannot pass
      // this by accident.
      const chosen = Object.fromEntries(
        spec.map((option) => [option.id, option.choices[option.choices.length - 1]?.value ?? ''])
      );
      const path = playPath({ gameId: manifest.id, options: chosen });
      const query = new URLSearchParams(path.split('?')[1] ?? '');
      expect(readOptionValues(spec, query), `${manifest.id}: options lost in the URL`).toEqual(
        chosen
      );
    }
  });

  it('names no mode for a solo game', () => {
    // Nothing reads it there — `<Lobby>` is the only reader and a solo game never mounts one — and
    // a query string that names a fact nobody consults is a fact something will eventually believe.
    const path = playPath({ gameId: 'solitaire', options: { draw: '3' } });
    expect(path).not.toContain('mode=');
    expect(path).toContain('o.draw=3');
  });

  it('is a bare path when there is nothing to carry', () => {
    expect(playPath({ gameId: 'blackjack', options: {} })).toBe('/play/blackjack');
    // An empty table code is the same as none: it is what an untouched join box holds.
    expect(playPath({ gameId: 'blackjack', table: '', options: {} })).toBe('/play/blackjack');
  });

  it('defaults are written too, so a shared link plays the game the sender saw', () => {
    const spec = registry.find((g) => g.manifest.id === 'tic-tac-toe')?.manifest.options ?? [];
    const path = playPath({ gameId: 'tic-tac-toe', options: defaultOptionValues(spec) });
    expect(path).toContain('o.house=perfect');
  });
});

describe('isPlainClick — the hub card stays a link', () => {
  const CLICK = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };

  it('is the modal on a plain left click', () => {
    expect(isPlainClick(CLICK)).toBe(true);
    // React does not always give a `button` (a keyboard "click" on an anchor is one), and the
    // absence of a mouse button is still a plain activation.
    expect(isPlainClick({ ...CLICK, button: undefined })).toBe(true);
  });

  it('is the BROWSER on every modifier — one short and "open in new tab" is gone', () => {
    expect(isPlainClick({ ...CLICK, ctrlKey: true })).toBe(false);
    expect(isPlainClick({ ...CLICK, metaKey: true })).toBe(false);
    expect(isPlainClick({ ...CLICK, shiftKey: true })).toBe(false);
    expect(isPlainClick({ ...CLICK, altKey: true })).toBe(false);
  });

  it('is the browser on a middle click', () => {
    expect(isPlainClick({ ...CLICK, button: 1 })).toBe(false);
  });
});

/**
 * AND IT MOUNTS. Everything above is a function; this is the component that renders them, put
 * through `renderToStaticMarkup` in Node the way `tests/modal.test.ts` does — no DOM, so the
 * effects (which is all `showModal()` is) do not run, but the markup a browser would be handed
 * does.
 *
 * It is worth its seconds because the mode step is the first thing a player sees and the ways it
 * could fail are not visible in a diff: the modal mounts a throwaway `<GameShell>` (which reads the
 * router, and would throw outside one), and it pulls `<TableSetup>` into the hub's import graph.
 * A crash on mount would look exactly like the card doing nothing.
 */
describe('the modal draws that list', () => {
  /** React escapes text it renders; a name with an apostrophe in it comes back as `&#x27;`. */
  const decode = (html: string): string =>
    html
      .replaceAll('&#x27;', "'")
      .replaceAll('&quot;', '"')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&');

  /** The text of every button in the markup, minus the modal's own × close. */
  const buttonTexts = (html: string): string[] =>
    [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)]
      .map((m) => decode(m[1] ?? ''))
      .filter((text) => text !== '×');

  const renderFor = (game: RegisteredGame): string =>
    renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(GameLaunchModal, { game, onClose: () => undefined })
      )
    );

  it('opens on the ways in, labelled, for every registered game', () => {
    for (const game of registry) {
      const html = renderFor(game);
      expect(decode(html), `${game.manifest.id}: the modal does not name the game`).toContain(
        game.manifest.name
      );
      expect(buttonTexts(html), `${game.manifest.id}: the buttons are not the ways in`).toEqual(
        launchModes(game.manifest).map((m) => m.label)
      );
    }
  });

  it('draws nothing at all when nothing is launching', () => {
    // The hub keeps one modal mounted for every card, so "closed" has to be genuinely empty —
    // and it must not throw for want of a game to read a manifest from.
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(GameLaunchModal, { game: null, onClose: () => undefined })
      )
    );
    expect(buttonTexts(html)).toEqual([]);
  });
});
