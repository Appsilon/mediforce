'use client';

import { useMemo } from 'react';
import { where, orderBy } from 'firebase/firestore';
import type { ProcessDefinition, WorkflowDefinition } from '@mediforce/platform-core';
import { useCollection } from './use-collection';

// Firestore documents always have an auto-added id field
type ProcessDefinitionDoc = ProcessDefinition & { id: string };
type WorkflowDefinitionDoc = WorkflowDefinition & { id: string };

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
  hasManualTrigger: boolean;
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

/** Normalize a WorkflowDefinition doc to look like a ProcessDefinition doc for grouping. */
function normalizeWorkflow(doc: WorkflowDefinitionDoc): ProcessDefinitionDoc {
  return {
    ...doc,
    version: String(doc.version),
  } as unknown as ProcessDefinitionDoc;
}

export function useProcessDefinitions() {
  const legacyConstraints = useMemo(() => [orderBy('name', 'asc')], []);
  const workflowConstraints = useMemo(() => [orderBy('name', 'asc')], []);

  const { data: legacyData, loading: legacyLoading, error: legacyError } = useCollection<ProcessDefinitionDoc>(
    'processDefinitions',
    legacyConstraints,
  );
  const { data: workflowData, loading: workflowLoading, error: workflowError } = useCollection<WorkflowDefinitionDoc>(
    'workflowDefinitions',
    workflowConstraints,
  );

  const loading = legacyLoading || workflowLoading;
  const error = legacyError || workflowError;

  // Merge both sources into a single list, deduplicating by name+version
  const allDocs = useMemo((): ProcessDefinitionDoc[] => {
    const seen = new Set<string>();
    const result: ProcessDefinitionDoc[] = [];

    // Workflow definitions take priority
    for (const doc of workflowData) {
      const key = `${doc.name}:${doc.version}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(normalizeWorkflow(doc));
      }
    }
    // Then legacy
    for (const doc of legacyData) {
      const key = `${doc.name}:${doc.version}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(doc);
      }
    }

    return result;
  }, [legacyData, workflowData]);

  const definitions = useMemo((): DefinitionGroup[] => {
    const byName = new Map<string, { versions: DefinitionVersion[]; docs: ProcessDefinitionDoc[] }>();

    for (const def of allDocs) {
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
      const hasManualTrigger = latestDoc.triggers.some((trigger) => trigger.type === 'manual');
      return {
        name,
        description: latest.description,
        latestVersion: latest.version,
        versions: sorted,
        stepCount: latest.stepCount,
        hasManualTrigger,
        repo: latestDoc.repo,
        url: latestDoc.url,
        archived: latestDoc.archived,
      };
    });
  }, [allDocs]);

  /** Map from definition name to ordered non-terminal step IDs (latest version). */
  const stepsByDefinition = useMemo((): Map<string, string[]> => {
    const byName = new Map<string, ProcessDefinitionDoc[]>();
    for (const doc of allDocs) {
      const existing = byName.get(doc.name) ?? [];
      existing.push(doc);
      byName.set(doc.name, existing);
    }
    const result = new Map<string, string[]>();
    for (const [name, docs] of byName) {
      const latest = [...docs].sort((a, b) => compareSemver(b.version, a.version))[0];
      if (latest) {
        result.set(
          name,
          latest.steps.filter((step) => step.type !== 'terminal').map((step) => step.id),
        );
      }
    }
    return result;
  }, [allDocs]);

  return { definitions, stepsByDefinition, loading, error };
}

export function useProcessDefinitionVersions(name: string) {
  const legacyConstraints = useMemo(
    () => [where('name', '==', name), orderBy('version', 'asc')],
    [name],
  );
  const workflowConstraints = useMemo(
    () => [where('name', '==', name), orderBy('version', 'asc')],
    [name],
  );
  const { data: legacyData, loading: legacyLoading } = useCollection<ProcessDefinitionDoc>(
    'processDefinitions',
    legacyConstraints,
  );
  const { data: workflowData, loading: workflowLoading } = useCollection<WorkflowDefinitionDoc>(
    'workflowDefinitions',
    workflowConstraints,
  );

  const loading = legacyLoading || workflowLoading;

  const merged = useMemo(() => {
    const seen = new Set<string>();
    const result: ProcessDefinitionDoc[] = [];
    for (const doc of workflowData) {
      const key = String(doc.version);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(normalizeWorkflow(doc));
      }
    }
    for (const doc of legacyData) {
      if (!seen.has(doc.version)) {
        seen.add(doc.version);
        result.push(doc);
      }
    }
    return result;
  }, [legacyData, workflowData]);

  const sorted = useMemo(
    () => [...merged].sort((a, b) => compareSemver(b.version, a.version)),
    [merged],
  );
  return { versions: sorted, loading, error: null };
}
