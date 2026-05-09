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

function groupKey(doc: WorkflowDefinitionDoc): string {
  return `${doc.namespace ?? ''}:${doc.name}`;
}

function getLatestByName(docs: WorkflowDefinitionDoc[]): Map<string, WorkflowDefinitionDoc> {
  const byKey = new Map<string, WorkflowDefinitionDoc[]>();
  for (const doc of docs) {
    const key = groupKey(doc);
    const existing = byKey.get(key) ?? [];
    existing.push(doc);
    byKey.set(key, existing);
  }
  const result = new Map<string, WorkflowDefinitionDoc>();
  for (const [key, group] of byKey) {
    const latest = [...group].sort((a, b) => compareSemver(String(b.version), String(a.version)))[0];
    if (latest) result.set(key, latest);
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
    const byKey = new Map<string, DefinitionVersion[]>();
    for (const def of allDocs) {
      const key = groupKey(def);
      const entry = byKey.get(key) ?? [];
      entry.push({
        version: String(def.version),
        stepCount: def.steps.length,
        triggerCount: def.triggers.length,
        title: def.title,
        description: def.description,
      });
      byKey.set(key, entry);
    }

    return Array.from(byKey.entries()).map(([key, versions]) => {
      const sorted = [...versions].sort((a, b) => compareSemver(b.version, a.version));
      const latestDoc = latestDocs.get(key)!;
      const name = latestDoc.name;
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
        visibility: latestDoc.visibility,
      };
    });
  }, [allDocs, latestDocs]);

  const stepsByDefinition = useMemo((): Map<string, string[]> => {
    const result = new Map<string, string[]>();
    for (const [_key, doc] of latestDocs) {
      result.set(
        doc.name,
        doc.steps.filter((step) => step.type !== 'terminal').map((step) => step.id),
      );
    }
    return result;
  }, [latestDocs]);

  return { definitions, stepsByDefinition, latestDocs, loading, error };
}

export function useProcessDefinitionVersions(name: string, namespace: string) {
  const workflowConstraints = useMemo(
    () => [where('name', '==', name)],
    [name],
  );
  const { data: workflowData, loading } = useCollection<WorkflowDefinitionDoc>(
    'workflowDefinitions',
    workflowConstraints,
  );

  const sorted = useMemo(() => {
    const filtered = workflowData.filter((doc) => !doc.deleted && doc.namespace === namespace);
    return [...filtered].sort((a, b) => compareSemver(String(b.version), String(a.version)));
  }, [workflowData, namespace]);

  return { versions: sorted, loading, error: null };
}
