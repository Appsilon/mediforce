'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { NamespaceSchema } from '@mediforce/platform-core';
import type { Namespace } from '@mediforce/platform-core';

export type UseUserNamespaceResult = {
  namespace: Namespace | null;
  loading: boolean;
};

/**
 * Looks up the personal namespace for the currently authenticated user
 * by querying `namespaces` where `linkedUserId == uid`.
 */
export function useUserNamespace(uid: string | null | undefined): UseUserNamespaceResult {
  const [namespace, setNamespace] = useState<Namespace | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (uid === null || uid === undefined || uid === '') {
      setNamespace(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    const namespacesRef = collection(db, 'namespaces');
    const namespacesQuery = query(namespacesRef, where('linkedUserId', '==', uid));

    getDocs(namespacesQuery)
      .then((snapshot) => {
        const firstDoc = snapshot.docs[0];
        if (firstDoc === undefined) {
          setNamespace(null);
        } else {
          const parsed = NamespaceSchema.safeParse(firstDoc.data());
          setNamespace(parsed.success ? parsed.data : null);
        }
        setLoading(false);
      })
      .catch(() => {
        setNamespace(null);
        setLoading(false);
      });
  }, [uid]);

  return useMemo(() => ({ namespace, loading }), [namespace, loading]);
}
