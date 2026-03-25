'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { NamespaceSchema } from '@mediforce/platform-core';
import type { Namespace } from '@mediforce/platform-core';

export type UseAllUserNamespacesResult = {
  namespaces: Namespace[];
  loading: boolean;
};

/**
 * Returns all namespaces the user belongs to (real-time):
 * - Personal namespace (namespaces where linkedUserId == uid)
 * - Org namespaces (from users/{uid}.organizations[] — via onSnapshot)
 */
export function useAllUserNamespaces(uid: string | null | undefined): UseAllUserNamespacesResult {
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [loading, setLoading] = useState(true);
  const prevOrgsRef = useRef<string>('');

  useEffect(() => {
    if (uid === null || uid === undefined || uid === '') {
      setNamespaces([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const unsubscribe = onSnapshot(doc(db, 'users', uid), async (userSnapshot) => {
      try {
        const collected: Namespace[] = [];
        const seenHandles = new Set<string>();

        // 1. Personal namespace
        const namespacesRef = collection(db, 'namespaces');
        const personalQuery = query(namespacesRef, where('linkedUserId', '==', uid));
        const personalSnapshot = await getDocs(personalQuery);

        for (const docSnapshot of personalSnapshot.docs) {
          const parsed = NamespaceSchema.safeParse(docSnapshot.data());
          if (parsed.success && !seenHandles.has(parsed.data.handle)) {
            seenHandles.add(parsed.data.handle);
            collected.push(parsed.data);
          }
        }

        // 2. Org namespaces from users/{uid}.organizations
        if (userSnapshot.exists()) {
          const userData = userSnapshot.data();
          const orgHandles = Array.isArray(userData.organizations) ? userData.organizations : [];

          const orgDocs = await Promise.all(
            orgHandles
              .filter((handle: unknown): handle is string => typeof handle === 'string')
              .filter((handle) => !seenHandles.has(handle))
              .map((handle) => getDoc(doc(db, 'namespaces', handle))),
          );

          for (const orgDoc of orgDocs) {
            if (!orgDoc.exists()) continue;
            const parsed = NamespaceSchema.safeParse(orgDoc.data());
            if (parsed.success && !seenHandles.has(parsed.data.handle)) {
              seenHandles.add(parsed.data.handle);
              collected.push(parsed.data);
            }
          }
        }

        setNamespaces(collected);
        setLoading(false);
      } catch {
        setNamespaces([]);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [uid]);

  return useMemo(() => ({ namespaces, loading }), [namespaces, loading]);
}
