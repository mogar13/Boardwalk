import type { ReactNode } from 'react';
import { cx } from '@/ui/cx';

/**
 * A LABELLED SECTION OF A PANEL: a tracked heading, the controls, and one line saying what the
 * choice does.
 *
 * WHY THIS IS A COMPONENT AND NOT A CLASS STRING PASTED SIX TIMES. It was the class string pasted
 * five times — the create panel's Players / Ante / House rules, the seat preview, the join form —
 * and the sixth section did not paste it. `<GameOptions>` drew its label INLINE, small, to the
 * right of a single button, so on the UNO panel the bot-difficulty picker read as a stray control
 * floating between two properly-headed sections and people simply did not see it. On Tic-Tac-Toe
 * it was worse: "HOUSE CASUAL SHARP PERFECT" in one row makes the heading look like a fourth
 * choice. Nothing was broken and nothing could have gone red — five copies agreeing and one
 * disagreeing is exactly the shape of drift a shared component makes unspellable, which is this
 * repo's whole "fix by type, not by convention" rule applied to a heading.
 *
 * IT DOES NOT OWN THE GROUP. The caller keeps `role="group" aria-label` on its own control row
 * rather than this rendering a real `<fieldset>`/`<legend>`: a fieldset is itself `role=group`
 * named by its legend, so the two would nest and every `getByRole('group', {name})` in the browser
 * recipe would become a strict-mode violation with two matches. What is shared here is the thing
 * that was actually drifting — the type treatment and the hint's position — and nothing else.
 *
 * THE HINT IS THE POINT AS MUCH AS THE HEADING IS. A control whose label is a noun ("Bots",
 * "Cross-stacking") tells you what it is and never what it does, and the answer was in the source
 * or in nobody's head. One muted line under the row is where a panel gets to explain itself.
 */
export interface FieldsetProps {
  /** The heading over the controls. A noun: what this section chooses. */
  legend: ReactNode;
  /** One line under the controls: what the current choice means. Omit rather than pad. */
  hint?: ReactNode;
  children?: ReactNode;
  /** Layout only — see Button.className. */
  className?: string;
}

/**
 * The one place this type treatment is named. `0.2em` and not `Input`'s `0.12em`: a field label
 * sits against its own box and a section heading has to carry across a whole panel.
 */
export const FIELDSET_LEGEND =
  'font-display text-bw-muted text-xs font-semibold tracking-[0.2em] uppercase';

export function Fieldset({ legend, hint, children, className }: FieldsetProps) {
  return (
    <div className={cx('flex flex-col gap-2', className)}>
      <span className={FIELDSET_LEGEND}>{legend}</span>
      {children}
      {hint !== undefined && <p className="text-bw-muted text-xs">{hint}</p>}
    </div>
  );
}
