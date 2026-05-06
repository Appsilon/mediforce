'use client';

import { useMemo } from 'react';
import { where, orderBy } from 'firebase/firestore';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import { useCollection } from './use-collection';

// Firestore documents always have an auto-added id field
type WorkflowDefinitionDoc = WorkflowDefinition & { id: string };

export interface DefinitionVersion {
  version: string;
  stepCount: number;
  triggerCount: number;
  title?: string;
  description?: string;
}

export interface DefinitionGroup {
  name: string;
  title?: string;
  description?: string;
  latestVersion: string;
  versions: DefinitionVersion[];
  stepCount: number;
  hasManualTrigger: boolean;
  repo?: { url: string; branch?: string; directory?: string };
  url?: string;
  archived?: boolean;
  namespace?: string;
  visibility?: string;
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

function getLatestByName(docs: WorkflowDefinitionDoc[]): Map<string, WorkflowDefinitionDoc> {
  const byName = new Map<string, WorkflowDefinitionDoc[]>();
  for (const doc of docs) {
    const existing = byName.get(doc.name) ?? [];
    existing.push(doc);
    byName.set(doc.name, existing);
  }
  const result = new Map<string, WorkflowDefinitionDoc>();
  for (const [name, group] of byName) {
    const latest = [...group].sort((a, b) => compareSemver(String(b.version), String(a.version)))[0];
    if (latest) result.set(name, latest);
  }
  return result;
}

export function useProcessDefinitions() {
  const workflowConstraints = useMemo(() => [orderBy('name', 'asc')], []);

  const { data: workflowData, loading, error } = useCollection<WorkflowDefinitionDoc>(
    'workflowDefinitions',
    workflowConstraints,
  );

  const allDocs = useMemo((): WorkflowDefinitionDoc[] => {
    return workflowData.filter((doc) => !doc.deleted);
  }, [workflowData]);

  const latestDocs = useMemo(() => getLatestByName(allDocs), [allDocs]);

  const definitions = useMemo((): DefinitionGroup[] => {
    const byName = new Map<string, DefinitionVersion[]>();
    for (const def of allDocs) {
      const entry = byName.get(def.name) ?? [];
      entry.push({
        version: String(def.version),
        stepCount: def.steps.length,
        triggerCount: def.triggers.length,
        title: def.title,
        description: def.description,
      });
      byName.set(def.name, entry);
    }

    return Array.from(byName.entries()).map(([name, versions]) => {
      const sorted = [...versions].sort((a, b) => compareSemver(b.version, a.version));
      const latestDoc = latestDocs.get(name)!;
      const latest = sorted[0];
      const hasManualTrigger = latestDoc.triggers.some((trigger) => trigger.type === 'manual');
      return {
        name,
        title: latest.title,
        description: latest.description,
        latestVersion: latest.version,
        versions: sorted,
        stepCount: latest.stepCount,
        hasManualTrigger,
        repo: latestDoc.repo,
        url: latestDoc.url,
        archived: latestDoc.archived,
        namespace: latestDoc.namespace,
        visibility: (latestDoc as Record<string, unknown>).visibility as string | undefined,
      };
    });
  }, [allDocs, latestDocs]);

  const stepsByDefinition = useMemo((): Map<string, string[]> => {
    const result = new Map<string, string[]>();
    for (const [name, doc] of latestDocs) {
      result.set(
        name,
        doc.steps.filter((step) => step.type !== 'terminal').map((step) => step.id),
      );
    }
    return result;
  }, [latestDocs]);

  return { definitions, stepsByDefinition, latestDocs, loading, error };
}

export function useProcessDefinitionVersions(name: string) {
  const workflowConstraints = useMemo(
    () => [where('name', '==', name), orderBy('version', 'asc')],
    [name],
  );
  const { data: workflowData, loading } = useCollection<WorkflowDefinitionDoc>(
    'workflowDefinitions',
    workflowConstraints,
  );

  const sorted = useMemo(() => {
    const filtered = workflowData.filter((doc) => !doc.deleted);
    return [...filtered].sort((a, b) => compareSemver(String(b.version), String(a.version)));
  }, [workflowData]);

  return { versions: sorted, loading, error: null };
}
