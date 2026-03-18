'use client';

import { useMemo } from 'react';
import { useCollection } from './use-collection';

interface UserProfile {
  id: string;
  uid: string;
  displayName: string;
  email: string;
}

export function useUserDisplayNames(): Map<string, string> {
  const { data: users } = useCollection<UserProfile>('users');
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const user of users) {
      map.set(user.uid, user.displayName);
    }
    return map;
  }, [users]);
}
