import * as React from 'react';
import { normaliseModelId } from '@mediforce/platform-core';
import type { ValidateModelsOutput } from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import type { WorkflowDefinition } from '@mediforce/platform-core';

type UnknownModelEntry = ValidateModelsOutput['unknown'][number];

interface ModelValidationResult {
  unknown: UnknownModelEntry[];
  isLoading: boolean;
  error: Error | null;
}

export function useModelValidation(definition: WorkflowDefinition | null | undefined): ModelValidationResult {
  const [unknown, setUnknown] = React.useState<UnknownModelEntry[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);

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
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    mediforce.models
      .validate({ modelIds })
      .then((data) => {
        if (cancelled) return;
        setUnknown(data.unknown ?? []);
        setIsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[useModelValidation] validation failed:', err);
        setError(err instanceof Error ? err : new Error('Model validation failed'));
        setUnknown([]);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, modelIds]);

  return { unknown, isLoading, error };
}
