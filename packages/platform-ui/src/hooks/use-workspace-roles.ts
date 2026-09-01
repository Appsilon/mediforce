'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { builtinRoleIds } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { stopRetryOn4xx } from '@/lib/retry';
import { useNamespaceMembers } from './use-namespace-members';

export interface UseWorkspaceRolesResult {
  /** The workspace's role vocabulary, sorted, de-duplicated. */
  roles: string[];
  /** Workflow names in the workspace, sorted — the scopes a grant can narrow to. */
  workflowNames: string[];
  /**
   * Roles at least one member can actually exercise on `options.workflowName`:
   * held workspace-wide, or held under a grant narrowed to that workflow.
   *
   * Omitting `workflowName` is a question with an answer, not the absence of
   * one: a workflow being authored has no name yet, so no grant can be
   * narrowed to it and the workspace-wide grants are exactly what reaches it.
   * Answering `null` there left the new-workflow editor silent about a role
   * nobody holds — the editor where that typo gets made.
   *
   * `null` is reserved for the member roster being unresolved — in flight, or
   * failed. Neither is an answer, and neither is the same as "nobody holds
   * anything": a caller warning about an unheld role has to keep them apart, or
   * every step warns about every role for as long as the roster is slow, and
   * forever after it errors.
   *
   * A grant narrowed to a *different* workflow is deliberately absent: it does
   * not let its holder act here, so counting it would silence the warning in
   * exactly the case the warning exists for (#1252).
   */
  heldRoles: string[] | null;
  loading: boolean;
  /**
   * Set when the workflow list could not be read. Distinct from an empty
   * `workflowNames`, and the editor has to keep them apart: "this workspace has
   * no workflows" means every grant is workspace-wide by construction, while
   * "we could not find out" means a grant written now would be workspace-wide
   * because the narrower choices never rendered.
   */
  error: Error | null;
}

/**
 * The workspace's process-role vocabulary (ADR-0019): roles already granted to
 * its members, unioned with the `roles` its workflow definitions declare.
 *
 * There is no vocabulary table and there deliberately never will be — roles are
 * free-form strings so an imported workflow package can name one this
 * deployment has never heard of. This union is what stands in for that table:
 * it answers "what roles exist here" off storage that already exists, and it
 * carries both directions the vocabulary grows from. A declared-but-unheld role
 * is the more important half — it is the one an admin has to grant before the
 * step that names it can be acted on, and the one a typo silently strands.
 *
 * A pick-list, never a validator: the editor still accepts free text, because
 * granting `reviewer` before any workflow declares it is a legitimate first
 * move and this list would otherwise refuse it.
 *
 * The built-ins (ADR-0020) are in the union unconditionally, before anyone
 * holds one: they are what a new workflow's access lists and a new human step
 * already name, so a workspace that has granted nothing would otherwise offer
 * an empty pick-list beside a gate quoting names it does not suggest.
 *
 * `workflowNames` rides along because it comes off the same fetch and the
 * editor needs it for the scope control next to the role — a grant narrowed to
 * a workflow that does not exist is the invisible row ADR-0019's cascades exist
 * to prevent.
 */
export function useWorkspaceRoles(
  handle: string,
  options: { enabled?: boolean; workflowName?: string } = {},
): UseWorkspaceRolesResult {
  // Only an editor needs the vocabulary, and the workflow list it is unioned
  // from is not free — a plain member reading the roster should not pay for a
  // pick-list they are not offered.
  const enabled = handle !== '' && options.enabled !== false;
  const { members, loading: membersLoading, resolved: rosterResolved } = useNamespaceMembers(handle);

  const workflows = useQuery({
    queryKey: ['workflows', 'roles', enabled ? handle : '__noop__'] as const,
    queryFn: async () => {
      const result = await mediforce.workflows.list({ namespace: handle });
      return result.definitions;
    },
    enabled,
    retry: stopRetryOn4xx,
  });

  const groups = workflows.data;

  const roles = useMemo(() => {
    const union = new Set<string>(builtinRoleIds());
    for (const member of members) {
      for (const grant of member.grants) union.add(grant.role);
    }
    for (const group of groups ?? []) {
      for (const role of group.definition?.roles ?? []) union.add(role);
    }
    return [...union].sort();
  }, [members, groups]);

  const workflowNames = useMemo(
    () => [...new Set((groups ?? []).map((group) => group.name))].sort(),
    [groups],
  );

  const scope = options.workflowName;
  const heldRoles = useMemo(() => {
    if (!rosterResolved) return null;
    const held = new Set<string>();
    for (const member of members) {
      for (const grant of member.grants) {
        if (grant.workflowName === null || grant.workflowName === scope) held.add(grant.role);
      }
    }
    return [...held].sort();
  }, [members, scope, rosterResolved]);

  return {
    roles,
    workflowNames,
    heldRoles,
    loading: membersLoading || workflows.isLoading,
    error: (workflows.error as Error | null) ?? null,
  };
}
