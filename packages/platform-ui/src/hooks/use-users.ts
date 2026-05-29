'use client';

import { useMemo } from 'react';
import { useNamespace } from './use-namespace';

export type UserInfo = {
  displayName: string;
  photoURL: string | undefined;
};

export function useUserProfiles(handle: string | null | undefined): Map<string, UserInfo> {
  const { members } = useNamespace(handle ?? '');
  return useMemo(() => {
    const map = new Map<string, UserInfo>();
    for (const member of members) {
      const info: UserInfo = {
        displayName: member.displayName ?? member.uid,
        photoURL: typeof member.avatarUrl === 'string' && member.avatarUrl !== '' ? member.avatarUrl : undefined,
      };
      map.set(member.uid, info);
    }
    return map;
  }, [members]);
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
