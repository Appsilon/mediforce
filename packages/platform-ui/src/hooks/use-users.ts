'use client';

import { useMemo } from 'react';
import { useCollection } from './use-collection';

interface UserProfile {
  id: string;
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
}

export type UserInfo = {
  displayName: string;
  photoURL: string | undefined;
};

export function useUserProfiles(): Map<string, UserInfo> {
  const { data: users } = useCollection<UserProfile>('users');
  return useMemo(() => {
    const map = new Map<string, UserInfo>();
    for (const user of users) {
      const info: UserInfo = {
        displayName: user.displayName ?? user.email ?? user.id,
        photoURL: typeof user.photoURL === 'string' && user.photoURL !== '' ? user.photoURL : undefined,
      };
      if (user.uid) map.set(user.uid, info);
      map.set(user.id, info);
    }
    return map;
  }, [users]);
}

export function useUserDisplayNames(): Map<string, string> {
  const profiles = useUserProfiles();
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const [uid, info] of profiles) {
      map.set(uid, info.displayName);
    }
    return map;
  }, [profiles]);
}
