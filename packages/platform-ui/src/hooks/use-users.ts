'use client';

import { useMemo } from 'react';
import { useNamespace } from './use-namespace';

export type UserInfo = {
  displayName: string;
  photoURL: string | undefined;
  personalHandle: string | undefined;
};

export function useUserProfiles(handle: string | null | undefined): Map<string, UserInfo> {
  const { members, personalHandles } = useNamespace(handle ?? '');
  return useMemo(() => {
    const map = new Map<string, UserInfo>();
    for (const member of members) {
      const info: UserInfo = {
        displayName: member.displayName ?? member.uid,
        photoURL: typeof member.avatarUrl === 'string' && member.avatarUrl !== '' ? member.avatarUrl : undefined,
        personalHandle: personalHandles.get(member.uid),
      };
      map.set(member.uid, info);
    }
    return map;
  }, [members, personalHandles]);
}

export function useUserDisplayNames(handle: string | null | undefined): Map<string, string> {
  const profiles = useUserProfiles(handle);
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const [uid, info] of profiles) {
      map.set(uid, info.displayName);
    }
    return map;
  }, [profiles]);
}

export function usePersonalHandles(handle: string | null | undefined): Map<string, string> {
  const { personalHandles } = useNamespace(handle ?? '');
  return personalHandles;
}
