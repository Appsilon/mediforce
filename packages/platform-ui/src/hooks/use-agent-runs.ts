'use client';

import * as React from 'react';
import { useMemo } from 'react';
import { orderBy, where, doc, onSnapshot } from 'firebase/firestore';
import type { AgentRun, ProcessInstance } from '@mediforce/platform-core';
import { db } from '@/lib/firebase';
import { useCollection, type FirestoreState } from './use-collection';

export function useAgentRuns(namespace: string): FirestoreState<AgentRun> {
  const constraints = useMemo(() => [orderBy('startedAt', 'desc')], []);
  const { data: allRuns, loading, error } = useCollection<AgentRun>('agentRuns', constraints);
  const processNameMap = useProcessNameMap(namespace);
  const data = useMemo(
    () => allRuns.filter((run) => processNameMap.has(run.processInstanceId)),
    [allRuns, processNameMap],
  );
  return { data, loading, error };
}

/**
 * Subscribe to processInstances scoped to `namespace` and return a Map of
 * instanceId -> definitionName. Namespace-scoped to prevent cross-workspace leaks.
 */
export function useProcessNameMap(namespace: string): Map<string, string> {
  const { data: instances } = useCollection<ProcessInstance>('processInstances');

  return useMemo(() => {
    const map = new Map<string, string>();
    for (const inst of instances) {
      if (inst.namespace === namespace) {
        map.set(inst.id, inst.definitionName);
      }
    }
    return map;
  }, [instances, namespace]);
}

/**
 * Subscribe to `agentRuns` filtered server-side by processInstanceId + stepId.
 * Returns an empty result while either argument is missing.
 *
 * Two equality predicates on a single collection don't require a composite
 * index — Firestore serves them by intersecting single-field indexes.
 */
export function useAgentRunsForStep(
  processInstanceId: string | null,
  stepId: string | null,
): FirestoreState<AgentRun> {
  const enabled = processInstanceId !== null && stepId !== null;
  const constraints = useMemo(
    () =>
      enabled
        ? [where('processInstanceId', '==', processInstanceId), where('stepId', '==', stepId)]
        : [],
    [enabled, processInstanceId, stepId],
  );
  return useCollection<AgentRun>(enabled ? 'agentRuns' : '', constraints);
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
