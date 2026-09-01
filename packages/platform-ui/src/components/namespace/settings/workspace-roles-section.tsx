'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Lock, Pencil, Plus, ShieldCheck, X } from 'lucide-react';
import type { RoleGrantInput } from '@mediforce/platform-api/contract';
import type { NamespaceMemberDetail } from '@/hooks/use-namespace-members';
import { useSetMemberRoles } from '@/hooks/use-namespace-mutations';
import { WORKFLOW_MANAGER_ROLE, findBuiltinRole } from '@mediforce/platform-core';
import { useWorkspaceRoles } from '@/hooks/use-workspace-roles';

const ROLE_OPTIONS_LIST_ID = 'workspace-role-options';

/**
 * One row per `(member, role)` means the roster grows with both, so a workspace
 * of 80 people holding three roles each is 240 rows — filter and pager are what
 * keep it a table you can answer a question from rather than one you scroll.
 *
 * Both are client-side: `users.listMembers` already returns every member with
 * their grants in one response, so paging over it costs no round-trip and
 * filtering stays instant. If that roster ever outgrows one response, the
 * server contract is what changes, not this.
 */
const PAGE_SIZES = [10, 25, 50, 100] as const;

/** Whether the workflow list a grant can be narrowed to is known yet. */
type ScopeStatus = 'loading' | 'error' | 'ready';

/** One row: this member holds this role, on these workflows. */
interface RoleAssignment {
  uid: string;
  memberName: string;
  role: string;
  /** Workflows the role is narrowed to. Empty means every workflow. */
  workflows: string[];
  /**
   * The workspace owner's `workflow-manager` (ADR-0020), which they hold
   * whatever this table is asked to write. Shown without its Edit and Remove
   * controls rather than with controls the server would undo: the owner is the
   * one seat that cannot be removed or demoted, so it is what guarantees a
   * workspace always has somebody who can reach a workflow anybody made.
   */
  locked: boolean;
}

/**
 * Grants regrouped one row per `(member, role)`.
 *
 * Storage keys a grant by `(uid, role, workflow)` because that is what a gate
 * looks up, but an admin granting `reviewer` on three workflows is doing one
 * thing, not three — so the roster shows one row and narrows it to a set.
 *
 * A role holding a workspace-wide grant reads as unnarrowed even when narrowed
 * rows sit beside it: the `NULL` already covers every workflow, so listing the
 * others would claim a limit that is not in force.
 */
function toAssignments(members: readonly NamespaceMemberDetail[]): RoleAssignment[] {
  const rows: RoleAssignment[] = [];
  for (const member of members) {
    const byRole = new Map<string, string[]>();
    for (const grant of member.grants) {
      const workflows = byRole.get(grant.role) ?? [];
      if (grant.workflowName !== null) workflows.push(grant.workflowName);
      byRole.set(grant.role, workflows);
    }
    for (const grant of member.grants) {
      if (grant.workflowName === null) byRole.set(grant.role, []);
    }
    for (const [role, workflows] of byRole) {
      rows.push({
        uid: member.uid,
        memberName: member.displayName ?? member.uid,
        role,
        workflows: [...workflows].sort(),
        locked: member.role === 'owner' && role === WORKFLOW_MANAGER_ROLE,
      });
    }
  }
  return rows.sort(
    (rowA, rowB) =>
      rowA.memberName.localeCompare(rowB.memberName) || rowA.role.localeCompare(rowB.role),
  );
}

/** The member's full grant list with `role` replaced by `workflows`. */
function withRole(
  grants: readonly RoleGrantInput[],
  role: string,
  workflows: readonly string[],
): RoleGrantInput[] {
  return [
    ...grants.filter((grant) => grant.role !== role),
    ...(workflows.length === 0
      ? [{ role, workflowName: null }]
      // Sorted here rather than at the control: checkboxes hand back click
      // order, and the same end state has to produce the same request.
      : [...workflows].sort().map((workflowName) => ({ role, workflowName }))),
  ];
}

function sameGrants(a: readonly RoleGrantInput[], b: readonly RoleGrantInput[]): boolean {
  const key = (grants: readonly RoleGrantInput[]) =>
    grants.map((grant) => `${grant.role} ${grant.workflowName ?? ''}`).sort().join('|');
  return key(a) === key(b);
}

/**
 * Which workflows a role is narrowed to, as checkboxes.
 *
 * Not a `<select multiple>`: picking a second entry there needs ctrl/cmd-click,
 * an affordance nothing on screen advertises, and a plain click silently
 * *replaces* the selection — so the control most likely to be used wrong is the
 * one that quietly revokes a grant the admin meant to keep.
 *
 * **All workflows** is a listed option rather than an inferred one. The grant is
 * workspace-wide when no workflow is named, but "leave it empty and it means
 * everything" is a rule the reader has to be told; a checked box states it. It
 * is also the state the control opens in for a new role — narrowing stays a
 * deliberate act, or the roster fragments into per-workflow grants nobody can
 * reason about (ADR-0019).
 *
 * Naming a workflow clears it, and it cannot be unchecked directly: "no
 * workflows at all" is not a grant this model can express, so the only way out
 * of workspace-wide is to pick what replaces it. The same rule locks the last
 * named workflow — unchecking it would land back on the empty list, which the
 * write reads as workspace-wide, so the gesture that looks like *narrowing
 * further* would in fact grant the role everywhere. Revoking is the X on the
 * row, not the last checkbox.
 *
 * `scopes` is three-valued rather than "a list that may be empty": an empty
 * list from a workspace with no workflows means every grant is workspace-wide
 * by construction, while an empty list because the read is in flight or failed
 * means the narrower choices the admin would have picked never rendered.
 */
function WorkflowCheckboxes({
  label,
  value,
  workflowNames,
  scopes,
  onChange,
}: {
  label: string;
  value: string[];
  workflowNames: string[];
  scopes: ScopeStatus;
  onChange: (workflows: string[]) => void;
}) {
  if (scopes !== 'ready') {
    return (
      <span className="text-xs text-muted-foreground">
        {scopes === 'loading' ? 'Loading workflows…' : 'Workflow list unavailable'}
      </span>
    );
  }
  if (workflowNames.length === 0) {
    return <span className="text-xs text-muted-foreground">All workflows</span>;
  }
  const allChecked = value.length === 0;
  return (
    <div
      role="group"
      aria-label={label}
      className="max-h-28 min-w-44 overflow-y-auto rounded-md border bg-background p-1"
    >
      <label className="mb-1 flex cursor-pointer items-center gap-1.5 rounded border-b px-1 pb-1.5 text-xs font-medium hover:bg-muted">
        <input
          type="checkbox"
          checked={allChecked}
          onChange={() => { if (!allChecked) onChange([]); }}
          className="h-3.5 w-3.5 shrink-0 accent-primary"
        />
        All workflows
      </label>
      {workflowNames.map((name) => {
        const checked = value.includes(name);
        const locked = checked && value.length === 1;
        return (
          <label
            key={name}
            title={
              locked
                ? `A role has to name at least one workflow — unchecking ${name} would grant it on every workflow. Remove the role to revoke it.`
                : undefined
            }
            className={`flex items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-muted ${
              locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            }`}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={locked}
              // Guarded here as well as by `disabled`, which only states the
              // rule: the attribute stops the pointer, the guard is what makes
              // the widening unreachable however the event arrives.
              onChange={() => {
                if (locked) return;
                onChange(checked ? value.filter((held) => held !== name) : [...value, name]);
              }}
              className="h-3.5 w-3.5 shrink-0 accent-primary"
            />
            <span className="truncate" title={name}>
              {name}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function WorkflowChips({ workflows }: { workflows: string[] }) {
  if (workflows.length === 0) {
    return <span className="text-xs text-muted-foreground">All workflows</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {workflows.map((workflow) => (
        <span
          key={workflow}
          title={workflow}
          className="inline-block max-w-[12rem] truncate rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] font-medium"
        >
          {workflow}
        </span>
      ))}
    </div>
  );
}

interface WorkspaceRolesSectionProps {
  handle: string;
  members: NamespaceMemberDetail[];
  /** Owner/admin get the editor; everyone else reads the roster. */
  canManageMembers: boolean;
  /** Surfaces a failed role mutation in the page-level danger banner. */
  onError: (message: string | null) => void;
}

/**
 * **Roles** — who does what in a process (`reviewer`, `PI`, `approver`),
 * ADR-0019. A table of its own rather than columns on the members table:
 * a member holds any number of roles, each narrowed to any number of
 * workflows, so one row per member forces a multi-value record into a single
 * cell and the reader loses which workflows belong to which role. One row per
 * `(member, role)` makes that correspondence the table's own structure.
 *
 * Distinct from **Membership** (`owner | admin | member`) on the members table
 * above, which is who administers the workspace. Both are per-workspace and
 * both are called "role" in the schema — see `CONTEXT.md`.
 *
 * The same grants render from the workflow side on the workflow Access tab;
 * same data, two views.
 */
export function WorkspaceRolesSection({
  handle,
  members,
  canManageMembers,
  onError,
}: WorkspaceRolesSectionProps) {
  const setMemberRoles = useSetMemberRoles(handle);
  const {
    roles: workspaceRoles,
    workflowNames,
    loading: scopesLoading,
    error: scopesError,
  } = useWorkspaceRoles(handle, { enabled: canManageMembers });

  // Every write gate hangs off this, not off `workflowNames.length`: until the
  // workflow list resolves the scope control can only offer "All workflows", so
  // a Grant pressed here writes the widest grant there is while the narrower
  // choices the admin was reaching for are still on their way — or, after a
  // failed read, never coming.
  const scopes: ScopeStatus = scopesError !== null ? 'error' : scopesLoading ? 'loading' : 'ready';

  const assignments = useMemo(() => toAssignments(members), [members]);
  const grantsOf = (uid: string): RoleGrantInput[] =>
    members.find((member) => member.uid === uid)?.grants ?? [];

  const [savingUid, setSavingUid] = useState<string | null>(null);
  /** `${uid} ${role}` of the row whose scope is open; `null` when none. */
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftWorkflows, setDraftWorkflows] = useState<string[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [newUid, setNewUid] = useState('');
  const [newRole, setNewRole] = useState('');

  const [memberFilter, setMemberFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const member = memberFilter.trim().toLowerCase();
    const role = roleFilter.trim().toLowerCase();
    return assignments.filter(
      (row) =>
        (member === '' || row.memberName.toLowerCase().includes(member)) &&
        (role === '' || row.role.toLowerCase().includes(role)),
    );
  }, [assignments, memberFilter, roleFilter]);

  // Clamped rather than reset by an effect: a removal can empty the last page,
  // and re-rendering past the end would show a blank table with no way back.
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const filtersActive = memberFilter.trim() !== '' || roleFilter.trim() !== '';

  function clearFilters() {
    setMemberFilter('');
    setRoleFilter('');
    setPage(0);
  }

  function reset() {
    setEditingKey(null);
    setAssigning(false);
    setDraftWorkflows([]);
    setNewUid('');
    setNewRole('');
  }

  async function write(uid: string, grants: RoleGrantInput[]) {
    if (sameGrants(grants, grantsOf(uid))) {
      reset();
      return;
    }
    onError(null);
    setSavingUid(uid);
    try {
      await setMemberRoles.mutateAsync({ handle, uid, grants });
      reset();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Failed to update roles.');
    } finally {
      setSavingUid(null);
    }
  }

  function submitAssign() {
    const role = newRole.trim();
    if (newUid === '' || role === '') return;
    void write(newUid, withRole(grantsOf(newUid), role, draftWorkflows));
  }

  const busy = savingUid !== null;

  return (
    <div className="mb-10">
      <div className="mb-1 flex items-center justify-between gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Roles
        </h2>
        {canManageMembers && !assigning && (
          <button
            type="button"
            onClick={() => { reset(); setAssigning(true); }}
            disabled={busy || members.length === 0 || scopes !== 'ready'}
            className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary transition-colors disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            Assign role
          </button>
        )}
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        What a member does in a process — <span className="font-medium">reviewer</span>,{' '}
        <span className="font-medium">PI</span>, <span className="font-medium">approver</span>.
        Separate from Membership above, which is who administers the workspace.
      </p>

      {canManageMembers && scopes === 'error' && (
        <p role="status" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Could not load this workspace&rsquo;s workflows, so a role cannot be narrowed to one
          right now. Existing assignments below are unaffected. Reload to try again.
        </p>
      )}

      {/* Suggestions only — the role vocabulary is open by construction
          (ADR-0019), so a name no workflow declares yet still lands. */}
      <datalist id={ROLE_OPTIONS_LIST_ID}>
        {workspaceRoles.map((role) => (
          <option key={role} value={role} label={findBuiltinRole(role)?.description} />
        ))}
      </datalist>

      {assigning && canManageMembers && (
        <div className="mb-4 rounded-lg border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs font-medium">
              Member
              <select
                autoFocus
                value={newUid}
                onChange={(event) => setNewUid(event.target.value)}
                aria-label="Member to assign a role to"
                className="rounded-md border bg-background px-2 py-1.5 text-xs font-normal"
              >
                <option value="">Select a member…</option>
                {members.map((member) => (
                  <option key={member.uid} value={member.uid}>
                    {member.displayName ?? member.uid}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium">
              Role
              <input
                value={newRole}
                onChange={(event) => setNewRole(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') reset();
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submitAssign();
                  }
                }}
                list={ROLE_OPTIONS_LIST_ID}
                placeholder="reviewer"
                aria-label="Role to assign"
                className="rounded-md border bg-background px-2 py-1.5 text-xs font-normal"
              />
            </label>

            <div className="flex flex-col gap-1 text-xs font-medium">
              Workflows
              {/* Nothing selected is the default and means the whole
                  workspace; narrowing costs a deliberate extra choice. */}
              <WorkflowCheckboxes
                label="Workflows for the new role"
                value={draftWorkflows}
                workflowNames={workflowNames}
                scopes={scopes}
                onChange={setDraftWorkflows}
              />
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={submitAssign}
              disabled={busy || newUid === '' || newRole.trim() === '' || scopes !== 'ready'}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
            >
              Grant
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {assignments.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={memberFilter}
            onChange={(event) => { setMemberFilter(event.target.value); setPage(0); }}
            placeholder="Filter member…"
            aria-label="Filter by member"
            className="w-44 rounded-md border bg-background px-2 py-1.5 text-xs"
          />
          <input
            value={roleFilter}
            onChange={(event) => { setRoleFilter(event.target.value); setPage(0); }}
            placeholder="Filter role…"
            list={ROLE_OPTIONS_LIST_ID}
            aria-label="Filter by role"
            className="w-44 rounded-md border bg-background px-2 py-1.5 text-xs"
          />
          {filtersActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-md border px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear
            </button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {filtered.length === assignments.length
              ? `${assignments.length} ${assignments.length === 1 ? 'assignment' : 'assignments'}`
              : `${filtered.length} of ${assignments.length}`}
          </span>
        </div>
      )}

      {assignments.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border bg-card py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <ShieldCheck className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No roles assigned yet.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border bg-card py-12 text-center">
          <p className="text-sm text-muted-foreground">No roles match these filters.</p>
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-md border px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary transition-colors"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          {/* Named so a caller can address this table rather than the members
              table above it — a member's name appears in both. */}
          <table aria-label="Roles" className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  Member
                </th>
                <th className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  Role
                </th>
                <th className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  Workflows
                </th>
                <th className="sr-only px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pageRows.map((row) => {
                const key = `${row.uid} ${row.role}`;
                const editing = editingKey === key;
                const rowBusy = savingUid === row.uid;
                return (
                  <tr key={key} className="transition-colors hover:bg-muted/30">
                    <td className="whitespace-nowrap px-4 py-3 font-medium">{row.memberName}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] font-medium">
                        {row.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {editing ? (
                        <div className="flex items-start gap-2">
                          <WorkflowCheckboxes
                            label={`Workflows for ${row.role} for ${row.memberName}`}
                            value={draftWorkflows}
                            workflowNames={workflowNames}
                            scopes={scopes}
                            onChange={setDraftWorkflows}
                          />
                          <div className="flex flex-col gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                void write(
                                  row.uid,
                                  withRole(grantsOf(row.uid), row.role, draftWorkflows),
                                )
                              }
                              disabled={rowBusy || scopes !== 'ready'}
                              className="rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={reset}
                              className="rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <WorkflowChips workflows={row.workflows} />
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {canManageMembers && row.locked && (
                        <div className="flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
                          <Lock className="h-3 w-3" strokeWidth={2.5} aria-hidden />
                          <span>The owner always holds this</span>
                        </div>
                      )}
                      {canManageMembers && !row.locked && !editing && (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              reset();
                              setEditingKey(key);
                              setDraftWorkflows(row.workflows);
                            }}
                            disabled={rowBusy || scopes !== 'ready' || workflowNames.length === 0}
                            aria-label={`Edit workflows for ${row.role} for ${row.memberName}`}
                            className="rounded p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors disabled:opacity-40"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void write(
                                row.uid,
                                grantsOf(row.uid).filter((grant) => grant.role !== row.role),
                              )
                            }
                            disabled={rowBusy}
                            aria-label={`Remove ${row.role} from ${row.memberName}`}
                            className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-40"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Shown from the smallest page size up, not from "more than one
              page": a reader who picked 100 rows still needs the control that
              gets them back to 10. */}
          {filtered.length > PAGE_SIZES[0] && (
            <div className="flex flex-wrap items-center gap-3 border-t px-4 py-2.5">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Rows
                <select
                  value={pageSize}
                  onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }}
                  aria-label="Rows per page"
                  className="rounded-md border bg-background px-1.5 py-1 text-xs"
                >
                  {PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>

              <span className="text-xs text-muted-foreground">
                {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, filtered.length)} of{' '}
                {filtered.length}
              </span>

              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage(safePage - 1)}
                  disabled={safePage === 0}
                  aria-label="Previous page"
                  className="rounded-md border p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="text-xs text-muted-foreground">
                  {safePage + 1} / {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(safePage + 1)}
                  disabled={safePage >= pageCount - 1}
                  aria-label="Next page"
                  className="rounded-md border p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
