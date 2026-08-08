/**
 * `blackjack`'s rulebook, as the package's public subpath: `@boardwalk/game-logic/games/blackjack`.
 *
 * The games get a subpath each instead of being folded into the root barrel because three of
 * them export a type called `Card` and two export `Suit`/`Rank` — one flat namespace would
 * force a rename on rules that are correct as they stand. A subpath keeps every import looking
 * the way it did when this file was `src/games/blackjack/logic/blackjack.ts`.
 */
export * from './logic/blackjack';
export * from './logic/view';
// The multi-seat container. It adds no rule — every question about a hand is still answered by
// `logic/blackjack`, which this imports and never re-derives. See its header for why the one-seat
// reducer above stays: it is the shape a live solo hand is PERSISTED in.
export * from './logic/table';
