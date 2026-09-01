'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { pinnedRolesForVerb, type WorkflowAccess } from '@mediforce/platform-core';
import { RoleMultiSelect } from './role-multi-select';
import { useNamespaceMembers } from '@/hooks/use-namespace-members';
import { useNamespaceRole } from '@/hooks/use-namespace-role';
import { useSetWorkflowAccess, useWorkflowAccess } from '@/hooks/use-workflow-access';
import { useWorkspaceRoles } from '@/hooks/use-workspace-roles';
import { cn } from '@/lib/utils';

const VERBS = [
  {
    key: 'run' as const,
    label: 'Run',
    covers: 'Starting a run of this workflow.',
    openLabel: 'Any member of this workspace can start a run.',
    restrictLabel: 'Restrict who can run it',
    pinnedLabel: 'can start a run',
    inputLabel: 'Add a role that may run this workflow',
  },
  {
    key: 'edit' as const,
    label: 'Edit',
    covers:
      'Registering a version, archiving, deleting, transferring, changing visibility, and moving the default version.',
    openLabel: 'Any member of this workspace can change this workflow.',
    restrictLabel: 'Restrict who can change it',
    pinnedLabel: 'can change this workflow',
    inputLabel: 'Add a role that may edit this workflow',
  },
];

/**
 * The built-in roles a gated verb always admits (ADR-0020), phrased for the
 * hint under its list.
 */
function describePinned(roles: readonly string[]): string {
  const quoted = roles.map((role) => `"${role}"`);
  if (quoted.length <= 1) return quoted.join('');
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

/**
 * The workflow **Access** tab (ADR-0019, issue #1253) — the epic's workflow
 * level, between workspace Membership below it and each step's `allowedRoles`
 * above it.
 *
 * Two lists that are different things, deliberately adjacent:
 *
 * - **The gates**, above: which Roles may run and which may edit *this*
 *   workflow. New storage, owned by this screen, administered by owner/admin.
 * - **The holders**, below: who actually holds each of those Roles here.
 *   That is the members' grant data (#1248) seen from the workflow side, and
 *   it is read-only. Without it an admin sets `run: [reviewer]` and has no way
 *   to see from this screen that nobody is a reviewer — the gate would look
 *   configured and behave like a wall.
 *
 * Neither list gates *reading*: every member of a workspace sees every
 * workflow in it, and `visibility` keeps its separate cross-workspace meaning.
 */
export function WorkflowAccessPanel({
  handle,
  workflowName,
}: {
  handle: string;
  workflowName: string;
}) {
  const { canAdmin } = useNamespaceRole(handle);
  const { access, caller, loading, error } = useWorkflowAccess(handle, workflowName);
  const save = useSetWorkflowAccess(handle, workflowName);
  const { roles: vocabulary } = useWorkspaceRoles(handle, { workflowName });
  const { members, resolved: rosterResolved } = useNamespaceMembers(handle);

  // The form is only seeded once the server has answered; until then there is
  // nothing to edit and an empty draft would read as "open to everyone".
  const [draft, setDraft] = React.useState<WorkflowAccess | null>(null);
  const editing = draft !== null;
  const current = draft ?? access;

  /** uid list per role, counting only grants that reach *this* workflow. */
  const holdersByRole = React.useMemo(() => {
    const byRole = new Map<string, string[]>();
    for (const member of members) {
      for (const grant of member.grants) {
        if (grant.workflowName !== null && grant.workflowName !== workflowName) continue;
        const holders = byRole.get(grant.role) ?? [];
        if (!holders.includes(member.uid)) holders.push(member.uid);
        byRole.set(grant.role, holders);
      }
    }
    return byRole;
  }, [members, workflowName]);

  const nameOf = React.useMemo(() => {
    const names = new Map(members.map((member) => [member.uid, member.displayName ?? member.uid]));
    return (uid: string): string => names.get(uid) ?? uid;
  }, [members]);

  /**
   * Roles the gates name that nobody can exercise here. Silent until the
   * roster resolves: an unanswered read and an empty workspace are the same
   * empty list and mean opposite things.
   */
  const unheld = React.useMemo(() => {
    if (!rosterResolved || current === null) return [];
    const named = [...new Set([...current.run, ...current.edit])];
    return named.filter((role) => (holdersByRole.get(role) ?? []).length === 0);
  }, [rosterResolved, current, holdersByRole]);

  const rows = React.useMemo(() => {
    const named = current === null ? [] : [...current.run, ...current.edit];
    return [...new Set([...named, ...holdersByRole.keys()])].sort();
  }, [current, holdersByRole]);

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-4 w-40 rounded bg-muted" />
        <div className="h-24 rounded bg-muted" />
      </div>
    );
  }

  if (error !== null || current === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Could not load this workflow&apos;s access settings.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold">Access</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Which roles may run and which may change this workflow. Unrestricted means any member of
          the workspace can do it. Restricting a verb always keeps the built-in role that carries
          it, so a workflow can be opened to more people but never closed to its executors or
          editors. Everyone in the workspace can see this workflow either way.
        </p>
      </div>

      <div className="space-y-5">
        {VERBS.map((verb) => {
          const pinned = pinnedRolesForVerb(verb.key);
          // An empty list *is* "any member" — the same state the storage keeps
          // and the gate reads. The checkbox names it rather than leaving the
          // reader to infer it from an empty box, which matters more now that
          // the restricted state can never be emptied one chip at a time.
          const restricted = current[verb.key].length > 0;
          return (
            <div key={verb.key} className="space-y-1.5">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium">{verb.label}</span>
                <span className="text-[11px] text-muted-foreground">{verb.covers}</span>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={restricted}
                  disabled={!canAdmin}
                  onChange={(event) =>
                    setDraft({
                      ...current,
                      [verb.key]: event.target.checked ? pinned : [],
                    })
                  }
                  className="h-3.5 w-3.5"
                />
                <span>{verb.restrictLabel}</span>
              </label>
              {restricted ? (
                <>
                  <RoleMultiSelect
                    value={current[verb.key]}
                    vocabulary={vocabulary}
                    onChange={(roles) => setDraft({ ...current, [verb.key]: roles })}
                    inputLabel={verb.inputLabel}
                    highlighted={unheld}
                    locked={pinned}
                    disabled={!canAdmin}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {describePinned(pinned)} always {verb.pinnedLabel}. Clear the restriction to
                    open this to every member of the workspace.
                  </p>
                </>
              ) : (
                <p className="text-[11px] text-muted-foreground">{verb.openLabel}</p>
              )}
            </div>
          );
        })}
      </div>

      {unheld.length > 0 && (
        <div className="flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-amber-500 shrink-0" strokeWidth={2} />
          <span className="text-[11px] text-amber-600 dark:text-amber-400">
            Nobody holds {unheld.map((role) => `"${role}"`).join(', ')} for this workflow. Until
            someone is granted {unheld.length === 1 ? 'it' : 'one of them'}, the gates naming{' '}
            {unheld.length === 1 ? 'it' : 'them'} are closed to everyone.
          </span>
        </div>
      )}

      {canAdmin && editing && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              await save.mutateAsync(draft);
              setDraft(null);
            }}
            disabled={save.isPending}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground',
              'hover:bg-primary/90 transition-colors',
              save.isPending && 'opacity-50 pointer-events-none',
            )}
          >
            {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save access
          </button>
          <button
            type="button"
            onClick={() => setDraft(null)}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          {save.error !== null && (
            <span className="text-xs text-destructive">{save.error.message}</span>
          )}
        </div>
      )}

      {!canAdmin && (
        <p className="text-xs text-muted-foreground">
          Only a workspace owner or admin can change these lists.
          {caller !== null && !caller.mayRun && ' You cannot start this workflow.'}
        </p>
      )}

      <div className="space-y-2 border-t pt-5">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-sm font-medium">Who holds these roles</h3>
          <Link href={`/${handle}/settings`} className="text-xs underline text-muted-foreground">
            Settings → Members
          </Link>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Grants that reach this workflow — held across the workspace, or narrowed to it. Roles are
          granted per member, not here.
        </p>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No process roles are granted in this workspace yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {rows.map((role) => {
                const holders = holdersByRole.get(role) ?? [];
                return (
                  <tr key={role} className="border-b last:border-0">
                    <td className="py-1.5 pr-4 align-top font-medium">{role}</td>
                    <td className="py-1.5 text-muted-foreground">
                      {holders.length === 0 ? (
                        <span className="text-amber-600 dark:text-amber-400">nobody</span>
                      ) : (
                        holders.map(nameOf).join(', ')
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
