'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, collectionGroup, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
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
 * - Org namespaces (via collectionGroup 'members' where uid == uid, then fetches parent namespace docs)
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

    const namespacesRef = collection(db, 'namespaces');
    const personalQuery = query(namespacesRef, where('linkedUserId', '==', uid));

    const membersQuery = query(collectionGroup(db, 'members'), where('uid', '==', uid));

    Promise.all([getDocs(personalQuery), getDocs(membersQuery)])
      .then(async ([personalSnapshot, membersSnapshot]) => {
        const collected: Namespace[] = [];
        const seenHandles = new Set<string>();

        for (const docSnapshot of personalSnapshot.docs) {
          const parsed = NamespaceSchema.safeParse(docSnapshot.data());
          if (parsed.success && !seenHandles.has(parsed.data.handle)) {
            seenHandles.add(parsed.data.handle);
            collected.push(parsed.data);
          }
        }

        const parentDocRefs = membersSnapshot.docs.map((memberDoc) => memberDoc.ref.parent.parent);

        const orgDocPromises = parentDocRefs
          .filter((parentRef): parentRef is NonNullable<typeof parentRef> => parentRef !== null)
          .map((parentRef) => getDoc(doc(db, parentRef.path)));

        const orgDocs = await Promise.all(orgDocPromises);

        for (const orgDoc of orgDocs) {
          if (!orgDoc.exists()) continue;
          const parsed = NamespaceSchema.safeParse(orgDoc.data());
          if (parsed.success && !seenHandles.has(parsed.data.handle)) {
            seenHandles.add(parsed.data.handle);
            collected.push(parsed.data);
          }
        }

        setNamespaces(collected);
        setLoading(false);
      })
      .catch(() => {
        setNamespaces([]);
        setLoading(false);
      });
  }, [uid]);

  return useMemo(() => ({ namespaces, loading }), [namespaces, loading]);
}
