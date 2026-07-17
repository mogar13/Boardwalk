import { Placeholder } from '@/shell/pages/Placeholder';

/**
 * The store is Phase 4 — it lands with the economy that gives it something to spend and
 * daily rewards that give it a reason to open. Building the catalogue now would be an
 * interface before its caller, the mistake this project keeps naming.
 */
export function Store() {
  return (
    <Placeholder title="The Store" phase="Phase 4 — economy + progress">
      <p>
        Card backs, avatars, and whatever else is worth spending a bankroll on. It opens with the
        economy in Phase 4 — a store with nothing priced and no way to pay is a window display, and
        this project does not ship those.
      </p>
    </Placeholder>
  );
}
