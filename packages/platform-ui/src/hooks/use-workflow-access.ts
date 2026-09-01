'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  GetWorkflowAccessOutput,
  SetWorkflowAccessOutput,
} from '@mediforce/platform-api/contract';
import type { WorkflowAccess } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';

export interface UseWorkflowAccessResult {
  /**
   * The workflow's `run` / `edit` role gates, or `null` until the server has
   * answered. `null` is not "open": an empty pair of lists is what open looks
   * like, and a caller that renders "anyone may run this" off an unresolved
   * read would state as fact something it has not been told.
   */
  access: WorkflowAccess | null;
  /**
   * Whether *this* caller may run / edit the workflow right now, answered by
   * the server with the predicate the gates enforce, or `null` while unknown.
   *
   * Never recomputed here from `access`. The browser cannot see grants
   * narrowed to this workflow — they live in `user_roles`, not in the session
   * — so a local answer would refuse people the server admits. That is the
   * class of bug #1249 and #1251 each deleted once already.
   */
  caller: GetWorkflowAccessOutput['caller'] | null;
  loading: boolean;
  error: Error | null;
}

/**
 * One workflow's access gates (ADR-0019, issue #1253).
 *
 * Readable by any member of the workspace: the Access tab is where someone
 * finds out why their Start button is disabled, so the read is not
 * admin-only — only the write is.
 */
export function useWorkflowAccess(
  namespace: string,
  name: string,
  options: { enabled?: boolean } = {},
): UseWorkflowAccessResult {
  const enabled = namespace !== '' && name !== '' && options.enabled !== false;
  const query = useQuery({
    queryKey: queryKeys.workflowAccess(
      enabled ? namespace : '__noop__',
      enabled ? name : '__noop__',
    ),
    queryFn: () => mediforce.workflows.getAccess({ namespace, name }),
    enabled,
    retry: stopRetryOn4xx,
  });

  return {
    access: query.data?.access ?? null,
    caller: query.data?.caller ?? null,
    loading: query.isLoading,
    error: (query.error as Error | null) ?? null,
  };
}

/**
 * Replace both gates. Owner/admin only server-side; the tab hides the controls
 * from everyone else rather than letting them submit into a 403.
 *
 * The response is written straight into the cache instead of invalidating,
 * because it carries the caller's re-resolved verbs: an admin who removes
 * themselves from `run` must see their own Start button go grey without a
 * refetch, and one who cannot must not be told they can.
 */
export function useSetWorkflowAccess(namespace: string, name: string) {
  const queryClient = useQueryClient();
  return useMutation<SetWorkflowAccessOutput, Error, WorkflowAccess>({
    mutationFn: (access) => mediforce.workflows.setAccess({ namespace, name, access }),
    onSuccess: (result) => {
      queryClient.setQueryData<GetWorkflowAccessOutput>(
        queryKeys.workflowAccess(namespace, name),
        result,
      );
    },
  });
}

/** "'reviewer'" / "one of 'reviewer', 'approver'" — the half sentence a gate's tooltip needs. */
export function describeRoles(roles: readonly string[]): string {
  const quoted = roles.map((role) => `'${role}'`).join(', ');
  return roles.length === 1 ? quoted : `one of ${quoted}`;
}

/**
 * Whether this caller may change the workflow, and what to say when they may
 * not (ADR-0019's `edit` verb).
 *
 * Every control the verb covers asks this — Save in the editor, Edit on the
 * Definitions tab, and Archive / Share / Transfer / Delete in the workflow
 * menu — so that a member without the role is *told*, rather than finding out
 * by clicking through to a 403 that surfaces as a raw error beside an
 * unrelated validation message. The same courtesy the Start button gives for
 * `run`, and the reason #1253 asks for a disabled button rather than a hidden
 * one: an action that vanishes teaches nobody who to ask.
 *
 * `mayEdit` is `true` while the read is unresolved. Greying out a control on
 * an answer we do not have yet is the worse error — the server still refuses
 * if it must.
 */
export function useWorkflowEditGate(
  namespace: string,
  name: string,
): { mayEdit: boolean; reason: string | undefined } {
  const { access, caller } = useWorkflowAccess(namespace, name);
  if (caller === null || caller.mayEdit) return { mayEdit: true, reason: undefined };
  return {
    mayEdit: false,
    reason:
      `Changing this workflow is restricted to ${describeRoles(access?.edit ?? [])}` +
      ' — see the Access tab',
  };
}
