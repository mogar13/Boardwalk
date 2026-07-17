import type { ReactNode } from 'react';
import { Card } from '@/ui';

/**
 * An honest "not built yet" page. Store and Leaderboard are routes the top bar links to, so
 * they must exist and resolve — but their contents belong to later phases (the store and
 * daily rewards are Phase 4; a live leaderboard reads a node that gets its writer in Phase
 * 4 too). A blank page reads as a bug; a page that says which phase owns it reads as a plan.
 *
 * This is a page, not a kit component — same call as App.tsx's `Section` in Phase 1. If a
 * second thing ever wants this shape, it graduates to `src/ui`; one use stays here.
 */
export function Placeholder({
  title,
  phase,
  children,
}: {
  title: string;
  phase: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-base-content text-3xl font-bold tracking-[0.08em] uppercase">
          {title}
        </h1>
        <span className="font-display text-bw-muted text-xs font-semibold tracking-[0.2em] uppercase">
          {phase}
        </span>
      </header>
      <Card className="text-bw-muted flex max-w-2xl flex-col gap-3 p-6 text-sm">{children}</Card>
    </div>
  );
}
