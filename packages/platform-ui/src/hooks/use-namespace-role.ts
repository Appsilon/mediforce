'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { NamespaceMemberSchema } from '@mediforce/platform-core';
import type { NamespaceMember } from '@mediforce/platform-core';

export type UseNamespaceRoleResult = {
  role: NamespaceMember['role'] | null;
  canAdmin: boolean;
  loading: boolean;
};

/**
 * Subscribes to the current user's member doc under `namespaces/{handle}/members/{uid}`
 * and derives whether they can perform admin-scoped actions (owner or admin).
 *
 * Returns `role: null` when the user is not a member, not signed in, or handle is empty.
 */
export function useNamespaceRole(handle: string): UseNamespaceRoleResult {
  const { firebaseUser } = useAuth();
  const [role, setRole] = useState<NamespaceMember['role'] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (handle === '' || firebaseUser === null) {
      setRole(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    const memberRef = doc(db, 'namespaces', handle, 'members', firebaseUser.uid);
    const unsubscribe = onSnapshot(
      memberRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setRole(null);
        } else {
          const parsed = NamespaceMemberSchema.safeParse(snapshot.data());
          setRole(parsed.success ? parsed.data.role : null);
        }
        setLoading(false);
      },
      () => {
        setRole(null);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [handle, firebaseUser]);

  return {
    role,
    canAdmin: role === 'owner' || role === 'admin',
    loading,
  };
}
