'use client';

import { useState, useEffect } from 'react';
import {
  collection,
  query,
  onSnapshot,
  type Query,
  type DocumentData,
  type QueryConstraint,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

const EMPTY_CONSTRAINTS: QueryConstraint[] = [];

export type FirestoreState<T> = {
  data: T[];
  loading: boolean;
  error: Error | null;
};

/**
 * Generic hook for real-time Firestore collection listening.
 * Returns { data, loading, error } and automatically unsubscribes on unmount.
 */
export function useCollection<T extends { id: string }>(
  collectionPath: string,
  constraints: QueryConstraint[] = EMPTY_CONSTRAINTS,
): FirestoreState<T> {
  const [state, setState] = useState<FirestoreState<T>>({
    data: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    setState((prev) => ({ ...prev, loading: true }));

    const colRef = collection(db, collectionPath);
    const q: Query<DocumentData> = constraints.length > 0
      ? query(colRef, ...constraints)
      : query(colRef);

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as T[];
        setState({ data: docs, loading: false, error: null });
      },
      (error) => {
        console.error(`Firestore error on ${collectionPath}:`, error);
        setState((prev) => ({ ...prev, loading: false, error }));
      },
    );

    return unsubscribe;
    // Callers must useMemo their constraints so the reference is stable
  }, [collectionPath, constraints]);

  return state;
}
