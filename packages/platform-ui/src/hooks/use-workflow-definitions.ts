'use client';

import { useMemo } from 'react';
import { where } from 'firebase/firestore';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import { useCollection } from './use-collection';

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

  return { definitions, latestVersion, loading, error };
}
