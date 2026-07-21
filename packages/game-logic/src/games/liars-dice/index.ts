/**
 * `liars-dice`'s rulebook, as the package's public subpath:
 * `@boardwalk/game-logic/games/liars-dice`.
 *
 * The referee imports this to DEAL the game — it is the second game the server runs, after
 * blackjack, and the first multiplayer one. The browser imports the same lines to render it.
 */
export * from './logic/liarsDice';
export * from './logic/view';
