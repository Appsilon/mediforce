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

export type FirestoreState<T> = {
  data: T[];
  loading: boolean;
  error: Error | null;
};

/**
 * Generic Firestore real-time collection hook using onSnapshot.
 *
 * WARNING: Callers must wrap QueryConstraint arrays in useMemo() to ensure
 * reference stability. New array references on every render will cause
 * infinite re-subscription cycles.
 *
 * Example:
 *   const constraints = useMemo(
 *     () => [where('assignedRole', '==', role)],
 *     [role],
 *   );
 *   const { data } = useCollection<HumanTask>('humanTasks', constraints);
 */
const EMPTY_CONSTRAINTS: QueryConstraint[] = [];

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
    const q: Query<DocumentData> =
      constraints.length > 0 ? query(colRef, ...constraints) : query(colRef);

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
        setState((prev) => ({ ...prev, loading: false, error }));
      },
    );

    return unsubscribe;
  }, [collectionPath, constraints]);

  return state;
}
