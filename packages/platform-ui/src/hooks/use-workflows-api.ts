'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import type { DefinitionGroup } from './use-process-definitions';

export interface ApiDefinitionItem {
  name: string;
  latestVersion: number;
  defaultVersion: number;
  definition: {
    name: string;
    version: number;
    steps: Array<{ id: string; type: string }>;
    triggers: Array<{ type: string; name: string }>;
    title?: string;
    description?: string;
    repo?: { url: string; branch?: string; directory?: string };
    url?: string;
    archived?: boolean;
    namespace?: string;
    visibility?: string;
  } | null;
}

export function mapApiToDefinitionGroups(
  items: ApiDefinitionItem[],
  handle: string,
): DefinitionGroup[] {
  return items
    .filter((item) => item.definition !== null && item.definition.namespace === handle)
    .map((item) => {
      const def = item.definition!;
      return {
        name: def.name,
        title: def.title,
        description: def.description,
        latestVersion: String(def.version),
        versions: [{
          version: String(def.version),
          stepCount: def.steps.length,
          triggerCount: def.triggers.length,
          title: def.title,
          description: def.description,
        }],
        stepCount: def.steps.length,
        hasManualTrigger: def.triggers.some((t) => t.type === 'manual'),
        repo: def.repo,
        url: def.url,
        archived: def.archived,
        namespace: def.namespace,
        visibility: def.visibility,
      };
    });
}

export function useWorkflowDefinitionsApi(handle: string): {
  definitions: DefinitionGroup[];
  loading: boolean;
  error: Error | null;
} {
  const [definitions, setDefinitions] = useState<DefinitionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!handle) {
      setDefinitions([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    apiFetch('/api/workflow-definitions')
      .then((res) => {
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        return res.json();
      })
      .then((data: { definitions: ApiDefinitionItem[] }) => {
        if (cancelled) return;
        setDefinitions(mapApiToDefinitionGroups(data.definitions, handle));
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setDefinitions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [handle]);

  return { definitions, loading, error };
}

export function useWorkflowDefinitionApi(name: string): {
  definition: ApiDefinitionItem['definition'];
  loading: boolean;
  error: Error | null;
} {
  const [definition, setDefinition] = useState<ApiDefinitionItem['definition']>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!name) {
      setDefinition(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    apiFetch(`/api/workflow-definitions/${encodeURIComponent(name)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        return res.json();
      })
      .then((data: { definition: ApiDefinitionItem['definition'] }) => {
        if (cancelled) return;
        setDefinition(data.definition);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setDefinition(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [name]);

  return { definition, loading, error };
}
