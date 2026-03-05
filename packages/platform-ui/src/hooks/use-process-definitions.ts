'use client';

import { useMemo } from 'react';
import { where, orderBy } from 'firebase/firestore';
import type { ProcessDefinition } from '@mediforce/platform-core';
import { useCollection } from './use-collection';

// Firestore documents always have an auto-added id field
type ProcessDefinitionDoc = ProcessDefinition & { id: string };

export interface DefinitionVersion {
  version: string;
  stepCount: number;
  triggerCount: number;
  description?: string;
}

export interface DefinitionGroup {
  name: string;
  description?: string;
  latestVersion: string;
  versions: DefinitionVersion[];
  stepCount: number;
  repo?: { url: string; branch?: string; directory?: string };
  url?: string;
  archived?: boolean;
}

function compareSemver(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function useProcessDefinitions() {
  const constraints = useMemo(() => [orderBy('name', 'asc')], []);
  const { data, loading, error } = useCollection<ProcessDefinitionDoc>(
    'processDefinitions',
    constraints,
  );

  const definitions = useMemo((): DefinitionGroup[] => {
    const byName = new Map<string, { versions: DefinitionVersion[]; docs: ProcessDefinitionDoc[] }>();

    for (const def of data) {
      const entry = byName.get(def.name) ?? { versions: [], docs: [] };
      entry.versions.push({
        version: def.version,
        stepCount: def.steps.length,
        triggerCount: def.triggers.length,
        description: def.description,
      });
      entry.docs.push(def);
      byName.set(def.name, entry);
    }

    return Array.from(byName.entries()).map(([name, { versions, docs }]) => {
      const sorted = [...versions].sort((a, b) => compareSemver(b.version, a.version));
      const latestDoc = [...docs].sort((a, b) => compareSemver(b.version, a.version))[0];
      const latest = sorted[0];
      return {
        name,
        description: latest.description,
        latestVersion: latest.version,
        versions: sorted,
        stepCount: latest.stepCount,
        repo: latestDoc.repo,
        url: latestDoc.url,
        archived: latestDoc.archived,
      };
    });
  }, [data]);

  return { definitions, loading, error };
}

export function useProcessDefinitionVersions(name: string) {
  const constraints = useMemo(
    () => [where('name', '==', name), orderBy('version', 'asc')],
    [name],
  );
  const { data, loading, error } = useCollection<ProcessDefinitionDoc>(
    'processDefinitions',
    constraints,
  );
  const sorted = useMemo(
    () => [...data].sort((a, b) => compareSemver(b.version, a.version)),
    [data],
  );
  return { versions: sorted, loading, error };
}
