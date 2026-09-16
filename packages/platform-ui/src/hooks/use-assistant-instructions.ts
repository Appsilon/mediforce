'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GetAssistantInstructionsOutput } from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';

export interface UseAssistantInstructionsResult {
  /** The saved text, or `''` — which is also what "saved nothing" looks like. */
  instructions: string;
  loading: boolean;
  error: Error | null;
}

/**
 * The caller's own standing instructions for the workflow assistant in one
 * workspace (the extra system prompt every turn there reads).
 *
 * ONE-SHOT per ADR-0006 §4 sub-case (a): this changes only when the person
 * editing it saves, and they are the only writer — there is no second actor to
 * watch for, so no polling and no focus refetch.
 */
export function useAssistantInstructions(namespace: string): UseAssistantInstructionsResult {
  const enabled = namespace !== '';
  const query = useQuery({
    queryKey: queryKeys.assistantInstructions(enabled ? namespace : '__noop__'),
    queryFn: () => mediforce.assistant.getInstructions({ namespace }),
    enabled,
    retry: stopRetryOn4xx,
  });

  return {
    instructions: query.data?.instructions ?? '',
    loading: query.isLoading,
    error: (query.error as Error | null) ?? null,
  };
}

/**
 * Replace them; `''` clears them.
 *
 * The saved text is written straight into the cache rather than invalidated:
 * the mutation already knows what it stored, and a refetch would only race the
 * next keystroke in the textarea it came from.
 */
export function useSetAssistantInstructions(namespace: string) {
  const queryClient = useQueryClient();
  return useMutation<GetAssistantInstructionsOutput, Error, string>({
    mutationFn: async (instructions) => {
      await mediforce.assistant.setInstructions({ namespace, instructions });
      return { instructions };
    },
    onSuccess: (result) => {
      queryClient.setQueryData<GetAssistantInstructionsOutput>(
        queryKeys.assistantInstructions(namespace),
        result,
      );
    },
  });
}
