import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Card } from '@/ui';

/**
 * `<TableAside>` — A GAME'S OWN PANEL, IN THE TABLE'S SIDEBAR, UNDER THE CHAT.
 *
 * WHAT IT IS FOR. UNO's move log is not decoration: every hand is face down, so the log is the only
 * place the table ever says that a bot drew four and lost its turn. It was drawn at the BOTTOM of
 * the board, below the player's own fan — which put a running commentary under the one element that
 * grows, so on a real table it was permanently off the bottom of the screen, and it squeezed the
 * felt it was supposed to be commenting on. The sidebar already holds the table's other running
 * text, and reading the two together is what a player actually wants.
 *
 * WHY A SEAM AND NOT A PROP ON `<Lobby>`. The lobby draws the sidebar and the game draws the board,
 * and the board is the lobby's `children` — so a game has no way to put anything BELOW the chat
 * without one of them learning about the other. A `moveLog` prop on `<Lobby>` would make the OS
 * carry a slot named after one game's feature; a `<TableAside>` the game renders from inside its
 * own board is the `<GameResult>` shape exactly: the GAME says what the panel is, the OS says where
 * it goes.
 *
 * WHY A PORTAL. It is the only way to render into an ancestor's subtree without hoisting the state
 * that feeds it. The move log's scrollback lives in the board (it is derived from the projection
 * the board already subscribes to), and moving it up into `<Lobby>` would mean the OS holding a
 * game's state. `<GameResult>` portals its own pill for a related reason, so this is a mechanism
 * the tree already uses rather than a new one.
 *
 * OUTSIDE A LOBBY IT RENDERS NOTHING, deliberately and silently. A solo game has no sidebar to
 * portal into; a game that renders one anyway should not crash and should not grow a second panel
 * in an arbitrary place. `null` is the honest answer, and the game's board is unchanged.
 */

/** The sidebar's mount node, published by `<Lobby>`. `null` anywhere else. */
const AsideSlot = createContext<HTMLElement | null>(null);

export interface TableAsideProps {
  /** The panel's heading, in the chat's own style so the column reads as one thing. */
  readonly title: string;
  /**
   * The scrolling body's ref and scroll handler — `useTailPin`'s `attach`/`onScroll`, when the
   * panel is a log that should follow its own tail. Omitted for a panel that simply scrolls.
   */
  readonly scroll?: {
    readonly attach: (el: HTMLDivElement | null) => void;
    readonly onScroll: () => void;
  };
  /** Pinned under the body, outside the scroll — a "jump to now" control, say. */
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}

export function TableAside({ title, scroll, footer, children }: TableAsideProps) {
  const slot = useContext(AsideSlot);
  if (slot === null) return null;
  return createPortal(
    <Card className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <h3 className="font-display text-bw-muted text-xs shrink-0 font-semibold tracking-[0.2em] uppercase">
        {title}
      </h3>
      {/* THE SCROLL CONTAINER IS THE OS'S, not the game's, and that is the whole of the height
          rule made unspellable rather than checked. A panel that sizes to its content grows the
          column, the column grows the page, and the second panel ends up below the fold — which
          has now happened twice. A game hands over lines; where they stop is not its decision. */}
      <div
        ref={scroll?.attach}
        onScroll={scroll?.onScroll}
        // `role="log"` rather than a hand-written `aria-live`: it is exactly what this is, it
        // implies `polite` for free, and it means a reader announces only what was APPENDED rather
        // than re-reading the panel. It moved here with the box — the move log carried its own
        // label and live region until the OS took the container, and a scrolling region with no
        // accessible name is one a screen-reader user cannot find.
        role="log"
        aria-label={title}
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain"
      >
        {children}
      </div>
      {footer !== undefined && <div className="shrink-0">{footer}</div>}
    </Card>,
    slot
  );
}

/**
 * The other half — `<Lobby>` publishes the node it drew under the chat, around the whole room view
 * so the board (its `children`) can reach it.
 *
 * THE SLOT ELEMENT ITSELF carries `empty:hidden`, which is load-bearing rather than tidy: it is a
 * flex item in a `gap`-ed column, so an EMPTY div still costs a gap — a visible band of dead space
 * under the chat at every table whose game contributes no panel, which is five games out of six.
 * `display: none` takes it out of the flex layout entirely, and `:empty` is exactly true until a
 * portal renders into it. See `<Lobby>` for where it is drawn.
 *
 * The node is held as STATE and not a bare ref, and that is the one thing here that would silently
 * half-work: a portal has to RE-RENDER once its target exists, and assigning a ref does not
 * schedule one. With a ref the aside would appear on whatever commit happened along next — so, at
 * a quiet table, not at all.
 */
export function TableAsideProvider({
  slot,
  children,
}: {
  slot: HTMLElement | null;
  children: ReactNode;
}) {
  return <AsideSlot.Provider value={slot}>{children}</AsideSlot.Provider>;
}
