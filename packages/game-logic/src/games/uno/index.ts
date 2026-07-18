/**
 * `uno`'s rulebook, as the package's public subpath: `@boardwalk/game-logic/games/uno`.
 *
 * The games get a subpath each instead of being folded into the root barrel because three of
 * them export a type called `Card` and two export `Suit`/`Rank` — one flat namespace would
 * force a rename on rules that are correct as they stand. A subpath keeps every import looking
 * the way it did when this file was `src/games/uno/logic/uno.ts`.
 */
export * from './logic/uno';
