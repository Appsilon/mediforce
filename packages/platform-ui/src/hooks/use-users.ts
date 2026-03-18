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
      const name = user.displayName ?? user.email ?? user.id;
      // Map by both uid field and document id (they may differ)
      if (user.uid) map.set(user.uid, name);
      map.set(user.id, name);
    }
    return map;
  }, [users]);
}
