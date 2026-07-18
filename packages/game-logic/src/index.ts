/**
 * `@boardwalk/game-logic` — the rules BOTH sides run.
 *
 * WHAT THIS PACKAGE IS FOR. Until Phase D the referee had its own copy of the money rules
 * (`boardwalk-api/src/domain/economy.ts`: prices, the daily ladder, the XP table, the opening
 * stake) and `tests/economy-parity.test.ts` asserted the two agreed. The copy was deliberate and
 * the guard was real — it caught a live drift the first time it ran — but a guarded duplication
 * is still a duplication, and the guard could only ever check the constants it was told to
 * check. This package deletes the second copy instead of watching it. The parity test went with
 * it, because a test comparing a thing to itself is a test that cannot fail.
 *
 * WHAT MAY LIVE HERE. Pure rules, and nothing else: no React, no DOM, no Firebase, no
 * `@/system`, no database, no clock read from inside a function (`now` is always a parameter).
 * That is the same contract `src/games/**\/logic/**` has always had, and it is enforced by the
 * same lint rule — `@boardwalk/no-impure-logic` was re-scoped to cover this tree in the commit
 * that created it, because a rule aimed at a directory that no longer holds the code matches
 * nothing, and a rule that matches nothing reports success.
 *
 * WHAT MUST NOT LIVE HERE. Anything a browser needs and a server does not, or vice versa:
 * `import.meta.env` (that is why `src/system/cards/cards.ts` stayed behind — it maps a card to a
 * base-path-aware URL), hooks, components, repos, `Session`.
 *
 * THE BUILD SEAM, because it is not symmetric and that is on purpose:
 *
 *   • The FRONTEND consumes this package's TypeScript SOURCE, through a `paths` entry in the
 *     tsconfigs and a matching `resolve.alias` in `vite.config.ts` — exactly how `@/` works. So
 *     there is no build step between editing a rule and seeing it in the browser, HMR still
 *     works, and `vitest` reads the same files the app does.
 *
 *   • The API consumes this package's BUILT CommonJS (`dist/`), through a `file:` dependency.
 *     `boardwalk-api` is CommonJS with `rootDir: src`, and that is the constraint that shaped
 *     everything: a shared package compiled INTO the API's `tsc` run would push its output under
 *     `dist/<something>/` and move the entrypoint, which is a change to the Pi's systemd unit
 *     made blind. As an ordinary node_modules dependency it does not — `rootDir` stays `src`,
 *     the output stays `dist/server.js`, and `ExecStart` does not change.
 *
 * The two halves cannot drift, because they are one source tree. What CAN go wrong is the API
 * running against a stale `dist/` — so `boardwalk-api`'s `build` builds this package first, and
 * `src/config.ts` fails fast at boot if the module is missing.
 *
 * The five games get a subpath each (`@boardwalk/game-logic/games/chess`) rather than being
 * folded in below — see any of their `index.ts` for why.
 */

export * from './profile/types';
export * from './profile/money';
export * from './profile/xp';
export * from './profile/defaults';
export * from './progress/stats';
export * from './progress/achievements';
export * from './economy/bet';
export * from './economy/result';
export * from './economy/tickets';
export * from './rewards/daily';
export * from './store/catalog';
export * from './store/packs';
