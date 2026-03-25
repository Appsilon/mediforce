'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { NamespaceSchema } from '@mediforce/platform-core';
import type { Namespace } from '@mediforce/platform-core';

export type UseAllUserNamespacesResult = {
  namespaces: Namespace[];
  loading: boolean;
};

/**
 * Returns all namespaces the user belongs to:
 * - Personal namespace (namespaces where linkedUserId == uid)
 * - Org namespaces (from users/{uid}.organizations[] array)
 * Results are merged and deduplicated by handle.
 */
export function useAllUserNamespaces(uid: string | null | undefined): UseAllUserNamespacesResult {
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (uid === null || uid === undefined || uid === '') {
      setNamespaces([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    async function fetchNamespaces() {
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
      const userDoc = await getDoc(doc(db, 'users', uid as string));
      if (userDoc.exists()) {
        const userData = userDoc.data();
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

      return collected;
    }

    fetchNamespaces()
      .then((result) => {
        setNamespaces(result);
        setLoading(false);
      })
      .catch(() => {
        setNamespaces([]);
        setLoading(false);
      });
  }, [uid]);

  return useMemo(() => ({ namespaces, loading }), [namespaces, loading]);
}
