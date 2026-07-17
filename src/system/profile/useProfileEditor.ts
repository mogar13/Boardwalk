import { useCallback } from 'react';
import { useAuthStore } from '@/system/auth/authStore';
import { displayNameFrom } from '@/system/auth/credentials';
import { useToast } from '@/ui';

/**
 * `useProfileEditor()` — the one editable thing on the profile page: the display name. (Avatar
 * is equipped through the store, which owns the cosmetic that reads it.)
 *
 * `rename` uses `displayNameFrom` — the SAME trim-and-cap the sign-up path uses — so an edited
 * name and a signed-up name are cleaned identically and both agree with the `name` validator in
 * database.rules.json. It is not the username: editing this never touches `usernames/`, so the
 * canonical login name and the shown name stay the two separate fields v1 kept for good reason.
 */
export interface ProfileEditorApi {
  /** Set the display name. Returns whether it saved, so a form can close on success and stay open on a miss. */
  readonly rename: (raw: string) => Promise<boolean>;
}

export function useProfileEditor(): ProfileEditorApi {
  const mutateProfile = useAuthStore((s) => s.mutateProfile);
  const toast = useToast();

  const rename = useCallback(
    async (raw: string): Promise<boolean> => {
      const p = useAuthStore.getState().profile;
      if (p === null) return false;

      const name = displayNameFrom(raw);
      if (name === '') {
        toast.warning('Your name can’t be empty.');
        return false;
      }
      if (name === p.name) return true; // nothing to save; treat as a successful no-op

      try {
        await mutateProfile({ ...p, name });
        toast.success('Name updated.');
        return true;
      } catch {
        toast.error('Could not save your name — try again.');
        return false;
      }
    },
    [mutateProfile, toast]
  );

  return { rename };
}
