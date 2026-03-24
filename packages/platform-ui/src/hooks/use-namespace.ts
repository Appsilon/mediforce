'use client';

import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { NamespaceSchema } from '@mediforce/platform-core';
import type { Namespace } from '@mediforce/platform-core';

export type UseNamespaceResult = {
  namespace: Namespace | null;
  loading: boolean;
  error: Error | null;
};

export function useNamespace(handle: string): UseNamespaceResult {
  const [namespace, setNamespace] = useState<Namespace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!handle) {
      setNamespace(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const namespaceRef = doc(db, 'namespaces', handle);

    getDoc(namespaceRef)
      .then((snapshot) => {
        if (!snapshot.exists()) {
          setNamespace(null);
        } else {
          const parsed = NamespaceSchema.safeParse(snapshot.data());
          if (parsed.success) {
            setNamespace(parsed.data);
          } else {
            setError(new Error('Invalid namespace data'));
            setNamespace(null);
          }
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
  }, [handle]);

  return { namespace, loading, error };
}
