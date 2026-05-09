'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import { where, doc, getDoc } from 'firebase/firestore';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import { useCollection } from './use-collection';
import { getFirestore } from 'firebase/firestore';
import { getApp } from 'firebase/app';

type WorkflowDefinitionDoc = WorkflowDefinition & { id: string };

export function useWorkflowDefinitions(name: string, namespace: string) {
  const constraints = useMemo(
    () => [where('name', '==', name)],
    [name],
  );

  const { data: wfData, loading, error: wfError } = useCollection<WorkflowDefinitionDoc>(
    name ? 'workflowDefinitions' : '',
    constraints,
  );

  console.log('[useWorkflowDefinitions] raw', {
    name, namespace, loading,
    rawCount: wfData.length,
    rawNamespaces: [...new Set(wfData.map((d) => d.namespace))],
    rawVersions: wfData.map((d) => `${d.namespace}:v${d.version}`),
  });

  const definitions = useMemo(() => {
    return wfData
      .filter((d) => !d.deleted && d.namespace === namespace)
      .sort((a, b) => b.version - a.version);
  }, [wfData, namespace]);

  console.log('[useWorkflowDefinitions] filtered', {
    filteredCount: definitions.length,
    filteredVersions: definitions.map((d) => d.version),
  });

  const latestVersion = definitions[0]?.version ?? 0;

  const [defaultVersion, setDefaultVersionState] = useState<number | null>(null);

  const refreshDefault = useCallback(async () => {
    if (!name || !namespace) return;
    try {
      const db = getFirestore(getApp());
      const metaRef = doc(db, 'workflowMeta', `${namespace}:${name}`);
      const snap = await getDoc(metaRef);
      if (!snap.exists()) {
        setDefaultVersionState(null);
        return;
      }
      const data = snap.data();
      setDefaultVersionState(typeof data?.defaultVersion === 'number' ? data.defaultVersion : null);
    } catch {
      setDefaultVersionState(null);
    }
  }, [name, namespace]);

  useEffect(() => { refreshDefault(); }, [refreshDefault]);

  const effectiveVersion = defaultVersion ?? latestVersion;
  console.log('[useWorkflowDefinitions] resolved', { latestVersion, defaultVersion, effectiveVersion });

  return { definitions, latestVersion, defaultVersion, effectiveVersion, loading, error: wfError, refreshDefault };
}
