'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import { where, doc, getDoc } from 'firebase/firestore';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import { useCollection } from './use-collection';
import { getFirestore } from 'firebase/firestore';
import { getApp } from 'firebase/app';

type WorkflowDefinitionDoc = WorkflowDefinition & { id: string };

// Legacy processDefinitions documents store version as a semver string.
type LegacyDefinitionDoc = {
  id: string;
  name: string;
  version: string;
  title?: string;
  description?: string;
  steps: { id: string; type?: string; [key: string]: unknown }[];
  triggers: { type: string; name: string; [key: string]: unknown }[];
  transitions: { from: string; to: string; when?: string }[];
  archived?: boolean;
  deleted?: boolean;
  createdAt?: string;
  namespace?: string;
  [key: string]: unknown;
};

/** Normalize a legacy ProcessDefinition doc to the WorkflowDefinition shape. */
function normalizeLegacyDoc(doc: LegacyDefinitionDoc): WorkflowDefinitionDoc | null {
  const versionNum = parseInt(doc.version, 10);
  if (isNaN(versionNum) || versionNum <= 0) return null;
  return { ...doc, version: versionNum } as unknown as WorkflowDefinitionDoc;
}

export function useWorkflowDefinitions(name: string) {
  const constraints = useMemo(
    () => [where('name', '==', name)],
    [name],
  );

  // Primary source: workflowDefinitions collection (integer versions)
  const { data: wfData, loading: wfLoading, error: wfError } = useCollection<WorkflowDefinitionDoc>(
    name ? 'workflowDefinitions' : '',
    constraints,
  );

  // Fallback source: legacy processDefinitions collection (semver string versions)
  const { data: legacyData, loading: legacyLoading } = useCollection<LegacyDefinitionDoc>(
    name ? 'processDefinitions' : '',
    constraints,
  );

  const loading = wfLoading || legacyLoading;

  const definitions = useMemo(() => {
    const seen = new Set<number>();
    const merged: WorkflowDefinitionDoc[] = [];

    // workflowDefinitions take priority
    for (const doc of wfData) {
      if (doc.deleted) continue;
      if (!seen.has(doc.version)) {
        seen.add(doc.version);
        merged.push(doc);
      }
    }

    // Normalize and add legacy docs where no wf version covers the same version number
    for (const doc of legacyData) {
      if ((doc as { deleted?: boolean }).deleted) continue;
      const normalized = normalizeLegacyDoc(doc);
      if (normalized && !seen.has(normalized.version)) {
        seen.add(normalized.version);
        merged.push(normalized);
      }
    }

    return merged.sort((a, b) => b.version - a.version);
  }, [wfData, legacyData]);

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
