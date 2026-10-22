'use client';

import * as React from 'react';
import { useAuth } from '@/contexts/auth-context';
import { readWorkflowOrder, workflowOrderStorageKey } from '@/lib/workflow-order';

/**
 * The user's own card order for a workspace's catalog, kept in localStorage
 * (per browser). Storage failures (private mode, blocked site data) degrade to
 * the default order for the session.
 */
export function useWorkflowOrder(handle: string): [string[], (order: string[]) => void] {
  const { user } = useAuth();
  const storageKey = user?.id !== undefined ? workflowOrderStorageKey(user.id, handle) : null;
  const [saved, setSaved] = React.useState(() => ({ key: storageKey, order: readWorkflowOrder(storageKey) }));

  // Read during render, not in an effect, so the cards never flash the default order first.
  if (saved.key !== storageKey) {
    setSaved({ key: storageKey, order: readWorkflowOrder(storageKey) });
  }

  const saveOrder = React.useCallback(
    (next: string[]) => {
      setSaved({ key: storageKey, order: next });
      if (storageKey === null) return;
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Not persisted; the new order still holds until reload.
      }
    },
    [storageKey],
  );

  return [saved.order, saveOrder];
}
