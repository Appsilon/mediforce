'use client';

import * as React from 'react';
import { useMemo } from 'react';
import { orderBy, doc, onSnapshot } from 'firebase/firestore';
import type { AgentRun, ProcessInstance } from '@mediforce/platform-core';
import { db } from '@/lib/firebase';
import { useCollection } from './use-collection';

export function useAgentRuns() {
  // Always order by startedAt desc — most recent runs first
  // The agentRuns collection was created in Plan 01 (FirestoreAgentRunRepository + AgentRunner write path)
  const constraints = useMemo(
    () => [orderBy('startedAt', 'desc')],
    [],
  );
  return useCollection<AgentRun>('agentRuns', constraints);
}

/**
 * Subscribe to all processInstances and return a Map of instanceId -> definitionName.
 * Single collection subscription avoids N+1 queries.
 */
export function useProcessNameMap(): Map<string, string> {
  const { data: instances } = useCollection<ProcessInstance>('processInstances');

  return useMemo(() => {
    const map = new Map<string, string>();
    for (const inst of instances) {
      map.set(inst.id, inst.definitionName);
    }
    return map;
  }, [instances]);
}

export function useAgentRun(runId: string | null) {
  const [run, setRun] = React.useState<AgentRun | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!runId) {
      setLoading(false);
      return;
    }
    const unsub = onSnapshot(doc(db, 'agentRuns', runId), (snap) => {
      if (snap.exists()) {
        setRun({ id: snap.id, ...snap.data() } as AgentRun);
      } else {
        setRun(null);
      }
      setLoading(false);
    });
    return unsub;
  }, [runId]);

  return { data: run, loading };
}
