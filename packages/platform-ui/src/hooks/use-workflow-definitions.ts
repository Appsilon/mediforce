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
  const { data, loading, error } = useCollection<WorkflowDefinitionDoc>(
    name ? 'workflowDefinitions' : '',
    constraints,
  );

  const definitions = useMemo(
    () => [...data].sort((a, b) => b.version - a.version),
    [data],
  );

  const latestVersion = definitions[0]?.version ?? 0;

  // Published version from workflowMeta/{name}
  const [publishedVersion, setPublishedVersionState] = useState<number | null>(null);

  const refreshPublished = useCallback(async () => {
    if (!name) return;
    try {
      const db = getFirestore(getApp());
      const metaRef = doc(db, 'workflowMeta', name);
      const snap = await getDoc(metaRef);
      if (snap.exists()) {
        const data = snap.data();
        // Read publishedVersion first, fall back to legacy defaultVersion
        const version = typeof data.publishedVersion === 'number' ? data.publishedVersion
          : typeof data.defaultVersion === 'number' ? data.defaultVersion
          : null;
        setPublishedVersionState(version);
      } else {
        setPublishedVersionState(null);
      }
    } catch {
      setPublishedVersionState(null);
    }
  }, [name]);

  useEffect(() => { refreshPublished(); }, [refreshPublished]);

  // Effective version for running: published if set, otherwise latest
  const effectiveVersion = publishedVersion ?? latestVersion;

  return { definitions, latestVersion, publishedVersion, effectiveVersion, loading, error, refreshPublished };
}
