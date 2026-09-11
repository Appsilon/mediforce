'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';

/**
 * Archive one version of a workflow, leaving its other versions alone.
 *
 * The granularity is the point: a version pinning an image nobody wants any
 * more is a reason to retire *that version*, not the workflow it belongs to.
 * Used by the Image Catalog's delete flow, where a live version pinning the
 * image is what blocks the delete.
 *
 * Not for a version the workflow pins as its default — archiving that leaves
 * the workflow pointing at something that cannot run. The caller checks
 * (`WorkflowImageMatch.isDefault`); the platform does not, which is why the
 * check has to be made rather than assumed.
 *
 * Invalidates every by-image read, because whether a version is archived is
 * exactly what those answers turn on — and stays pending until they refetch,
 * so a caller gating on `isPending` never acts on the pre-archive answer.
 */
export function useArchiveWorkflowVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { namespace: string; name: string; version: number }) =>
      mediforce.workflows.archiveVersion(
        { name: input.name, version: input.version, archived: true },
        { namespace: input.namespace },
      ),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workflowsByImageAll() }),
        // Archiving a workflow's last live version archives the workflow, which
        // moves its card behind "Archived workflows".
        queryClient.invalidateQueries({ queryKey: queryKeys.workflowsListAll() }),
      ]),
  });
}
