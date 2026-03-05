'use client';

import * as React from 'react';
import { useMemo } from 'react';
import { where, orderBy, doc, onSnapshot, collection } from 'firebase/firestore';
import type { ProcessInstance } from '@mediforce/platform-core';
import { db } from '@/lib/firebase';
import { useCollection } from './use-collection';

export type ProcessStatusFilter = 'all' | 'running' | 'paused' | 'completed' | 'failed' | 'created';

export function useProcessInstances(
  statusFilter: ProcessStatusFilter = 'all',
  definitionName?: string,
) {
  const constraints = useMemo(() => {
    const c = [];
    if (definitionName) {
      // When filtering by definitionName, skip orderBy to avoid requiring a
      // composite Firestore index. Results are sorted client-side below.
      c.push(where('definitionName', '==', definitionName));
      if (statusFilter !== 'all') c.push(where('status', '==', statusFilter));
    } else {
      if (statusFilter !== 'all') c.push(where('status', '==', statusFilter));
      c.push(orderBy('createdAt', 'desc'));
    }
    return c;
  }, [statusFilter, definitionName]);

  const result = useCollection<ProcessInstance>('processInstances', constraints);

  const data = useMemo(() => {
    if (!definitionName) return result.data;
    return [...result.data].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [result.data, definitionName]);

  return { ...result, data };
}

export function useProcessInstance(instanceId: string | null) {
  const [instance, setInstance] = React.useState<ProcessInstance | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!instanceId) {
      setLoading(false);
      return;
    }
    const unsub = onSnapshot(doc(db, 'processInstances', instanceId), (snap) => {
      if (snap.exists()) {
        setInstance({ id: snap.id, ...snap.data() } as ProcessInstance);
      } else {
        setInstance(null);
      }
      setLoading(false);
    });
    return unsub;
  }, [instanceId]);

  return { data: instance, loading };
}

// Subcollection hook for stepExecutions and agentEvents
export function useSubcollection<T extends { id: string }>(
  parentPath: string,
  subcollection: string,
) {
  const [state, setState] = React.useState<{ data: T[]; loading: boolean; error: Error | null }>({
    data: [],
    loading: true,
    error: null,
  });

  React.useEffect(() => {
    if (!parentPath) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    const colRef = collection(db, parentPath, subcollection);
    const unsub = onSnapshot(colRef, (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as T[];
      setState({ data: docs, loading: false, error: null });
    }, (error) => {
      setState((prev) => ({ ...prev, loading: false, error }));
    });
    return unsub;
  }, [parentPath, subcollection]);

  return state;
}
