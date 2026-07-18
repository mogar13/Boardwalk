/**
 * Cents → "$5,000.00". THE formatter — the one place the integer becomes a decimal, and now
 * a pure module so pure logic can reach it.
 *
 * It was born in `useProfile.ts`, which imports the Zustand store, so anything pure that
 * wanted to say "$500.00" in a message could not use it without dragging the store into a
 * unit test. `formatMoney` never needed the store — it is arithmetic and `toLocaleString` —
 * so it lives here, and `useProfile` re-exports it for the components that already import it
 * from there. Same function, one definition, reachable from `economy/bet.ts` without tainting
 * its purity.
 *
 * The rule it enforces is unchanged: a SECOND formatter is how one screen says $5,000 and
 * another says $5000.00. `data-money` in `@boardwalk/theme` handles the other half — tabular
 * figures, so a ticking balance does not reflow the way v1's HUD did.
 */
export function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Whole-dollar form — "$500", no cents — for the places a bet or a price is always a round
 * number of dollars (chips, catalog prices, table limits) and ".00" is just noise. Still one
 * definition, still here; a caller picks the form, never re-implements it.
 */
export function formatDollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}
