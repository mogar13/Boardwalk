import type { Rarity } from '@boardwalk/game-logic';
import { frameTone } from '@/system/frame/frames';
import { useAuthStore } from '@/system/auth/authStore';

/**
 * The tone of the frame YOU are wearing, or `null` for none — the reader that makes a `frame`
 * cosmetic real. The top bar and the profile card call this and hand the result to `<Avatar>`.
 *
 * DELIBERATELY YOUR OWN FRAME AND NOBODY ELSE'S. The leaderboard row renders other players, and
 * showing their frames would mean projecting the field into `leaderboard/<uid>` — a fourth pinned
 * `$other: false` node, its own `.validate`, its own refusal test and its own hand-run rules
 * deploy, on top of the three surfaces P5 already touches. That was the owner's call, and it is
 * the reason `<Avatar>` takes the frame as a PROP rather than reading this hook itself: the
 * leaderboard already renders `<Avatar>` and passes nothing, so projecting frames later is one
 * prop plus the rules work, with no component surgery.
 */
export function useEquippedFrame(): Rarity | null {
  return useAuthStore((s) => frameTone(s.profile?.equipped.frame));
}
