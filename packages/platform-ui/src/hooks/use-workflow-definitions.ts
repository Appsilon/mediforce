'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import { where, doc, getDoc } from 'firebase/firestore';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import { useCollection } from './use-collection';
import { getFirestore } from 'firebase/firestore';
import { getApp } from 'firebase/app';

type WorkflowDefinitionDoc = WorkflowDefinition & { id: string };

export function useWorkflowDefinitions(name: string) {
  const constraints = useMemo(
    () => [where('name', '==', name)],
    [name],
  );

  const { data: wfData, loading, error: wfError } = useCollection<WorkflowDefinitionDoc>(
    name ? 'workflowDefinitions' : '',
    constraints,
  );

  const definitions = useMemo(() => {
    return wfData
      .filter((d) => !d.deleted)
      .sort((a, b) => b.version - a.version);
  }, [wfData]);

  const latestVersion = definitions[0]?.version ?? 0;

  // Default version from workflowMeta/{name}
  const [defaultVersion, setDefaultVersionState] = useState<number | null>(null);

  const refreshDefault = useCallback(async () => {
    if (!name) return;
    try {
      const db = getFirestore(getApp());
      const metaRef = doc(db, 'workflowMeta', name);
      const snap = await getDoc(metaRef);
      if (snap.exists()) {
        const data = snap.data();
        setDefaultVersionState(typeof data.defaultVersion === 'number' ? data.defaultVersion : null);
      } else {
        setDefaultVersionState(null);
      }
    } catch {
      setDefaultVersionState(null);
    }
  }, [name]);

  useEffect(() => { refreshDefault(); }, [refreshDefault]);

  // Effective version for running: default if set, otherwise latest
  const effectiveVersion = defaultVersion ?? latestVersion;

  return { definitions, latestVersion, defaultVersion, effectiveVersion, loading, error: wfError, refreshDefault };
}
