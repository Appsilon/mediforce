'use client';

import { useState, useEffect, useRef } from 'react';
import {
  collection,
  query,
  onSnapshot,
  type Query,
  type DocumentData,
  type QueryConstraint,
  type FirestoreError,
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
const MAX_AUTH_RETRIES = 3;
const RETRY_DELAY_MS = 500;

export function useCollection<T extends { id: string }>(
  collectionPath: string,
  constraints: QueryConstraint[] = EMPTY_CONSTRAINTS,
): FirestoreState<T> {
  const [state, setState] = useState<FirestoreState<T>>({
    data: [],
    loading: true,
    error: null,
  });
  const retryCount = useRef(0);

  useEffect(() => {
    if (!collectionPath) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    setState((prev) => ({ ...prev, loading: true }));
    retryCount.current = 0;

    let unsubscribe: (() => void) | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    function subscribe() {
      const colRef = collection(db, collectionPath);
      const q: Query<DocumentData> =
        constraints.length > 0 ? query(colRef, ...constraints) : query(colRef);

      unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          if (cancelled) return;
          retryCount.current = 0;
          const docs = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) as T[];
          setState({ data: docs, loading: false, error: null });
        },
        (error: FirestoreError) => {
          if (cancelled) return;
          console.error('[useCollection]', collectionPath, 'error:', error.code, error.message);
          // onSnapshot terminates the listener on error. For permission-denied
          // errors during app startup, Firestore's auth token may not have
          // propagated yet — retry a few times to let it settle.
          if (error.code === 'permission-denied' && retryCount.current < MAX_AUTH_RETRIES) {
            retryCount.current += 1;
            retryTimer = setTimeout(() => {
              if (!cancelled) subscribe();
            }, RETRY_DELAY_MS * retryCount.current);
          } else {
            setState((prev) => ({ ...prev, loading: false, error }));
          }
        },
      );
    }

    subscribe();

    return () => {
      cancelled = true;
      unsubscribe?.();
      if (retryTimer !== undefined) clearTimeout(retryTimer);
    };
  }, [collectionPath, constraints]);

  return state;
}
