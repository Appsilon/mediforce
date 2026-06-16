import * as React from 'react';
import { apiFetch } from '@/lib/api-fetch';
import type { WorkflowDefinition } from '@mediforce/platform-core';

interface UnknownModelEntry {
  id: string;
  suggestion: string | null;
}

interface ModelValidationResult {
  unknown: UnknownModelEntry[];
  isLoading: boolean;
}

function normaliseModelId(raw: string): string {
  if (raw.includes('/')) return raw;
  const idx = raw.indexOf('__');
  return idx < 0 ? raw : `${raw.slice(0, idx)}/${raw.slice(idx + 2)}`;
}

export function useModelValidation(
  definition: WorkflowDefinition | undefined,
): ModelValidationResult {
  const [unknown, setUnknown] = React.useState<UnknownModelEntry[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);

  const modelIds = React.useMemo(() => {
    if (!definition) return [];
    const steps = Array.isArray(definition.steps) ? definition.steps : [];
    const ids = new Set<string>();
    for (const step of steps) {
      if (step.executor !== 'agent') continue;
      const raw = step.agent?.model;
      if (typeof raw === 'string' && raw.length > 0) {
        ids.add(normaliseModelId(raw));
      }
    }
    return Array.from(ids);
  }, [definition]);

  const cacheKey = modelIds.slice().sort().join(',');

  React.useEffect(() => {
    if (modelIds.length === 0) {
      setUnknown([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    apiFetch('/api/model-registry/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelIds }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setUnknown(data.unknown ?? []);
        setIsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setUnknown([]);
        setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [cacheKey]);

  return { unknown, isLoading };
}
