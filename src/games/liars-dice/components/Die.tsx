import { diceSrc, type Pips } from '@/system/dice/dice';
import { cx } from '@/ui';

/**
 * One die.
 *
 * It takes the dice-set id as a PROP rather than calling `useEquippedDice` itself — the same
 * reasoning as `<Avatar frame>` and `<Card felt>`. The board knows whose die it is drawing, and at
 * the reveal it draws five other people's; a component that asked the store who is signed in could
 * only ever draw your own set, and showing an opponent's set later would be component surgery
 * instead of one prop.
 *
 * `face` is the pip count and it is always drawn honestly. There is no "hidden die" variant here:
 * a die you may not see is not rendered as a die with an unknown face, it is rendered as a CUP
 * (below), because the client genuinely does not have the number. Drawing a face-down die from a
 * face the client secretly holds is how a projection leaks in the renderer.
 */
export function Die({
  face,
  diceId,
  size = 'md',
}: {
  face: Pips;
  diceId: string;
  size?: 'sm' | 'md';
}) {
  return (
    <img
      src={diceSrc(diceId, face)}
      alt={`${String(face)}`}
      className={cx('drop-shadow-md', size === 'sm' ? 'size-7' : 'size-10')}
    />
  );
}

/**
 * A die you cannot see — an opponent's, under the cup.
 *
 * Deliberately NOT a die image with a question mark on it. The player is not looking at a die whose
 * face is being withheld by the UI; they are looking at a cup, because the number does not exist on
 * this machine. Drawing the honest thing keeps the interface and the data model saying the same
 * sentence — the same argument `viewOf` makes for sending one dealer card instead of a fake one.
 */
export function HiddenDie({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return (
    <span
      aria-label="hidden die"
      className={cx(
        'border-base-content/20 bg-base-300/60 inline-block rounded-lg border-2 border-dashed',
        size === 'sm' ? 'size-7' : 'size-10'
      )}
    />
  );
}
