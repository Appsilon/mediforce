'use client';

import * as React from 'react';
import { useAuth } from '@/contexts/auth-context';
import { parseWorkflowOrder, workflowOrderStorageKey } from '@/lib/workflow-order';

/**
 * The user's own card order for a workspace's catalog, kept in localStorage
 * (per browser). Storage failures (private mode, blocked site data) degrade to
 * the default alphabetical order for the session.
 */
export function useWorkflowOrder(handle: string): [string[], (order: string[]) => void] {
  const { user } = useAuth();
  const storageKey = user?.id !== undefined ? workflowOrderStorageKey(user.id, handle) : null;
  const [order, setOrder] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (storageKey === null) return;
    try {
      setOrder(parseWorkflowOrder(localStorage.getItem(storageKey)));
    } catch {
      setOrder([]);
    }
  }, [storageKey]);

  const saveOrder = React.useCallback(
    (next: string[]) => {
      setOrder(next);
      if (storageKey === null) return;
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Not persisted; the new order still holds until reload.
      }
    },
    [storageKey],
  );

  return [order, saveOrder];
}
