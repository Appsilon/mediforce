import type { WorkflowAccess } from './workflow-access';

/**
 * The three actions ADR-0019 gates by role. `run` and `edit` are answered by
 * `workflow_access`, `act` by `step.allowedRoles`.
 */
export type RoleVerb = 'run' | 'edit' | 'act';

export interface BuiltinRole {
  /** The role name as it is stored in `user_roles.role` and read by the gate. */
  readonly id: string;
  readonly label: string;
  /** One sentence, shown wherever the role is offered — the pick-lists and the Roles table. */
  readonly description: string;
  /** What a workflow created after this role existed lets its holders do. */
  readonly verbs: readonly RoleVerb[];
}

/**
 * The roles every deployment knows about, and the privilege each one carries
 * on a workflow created from now on (ADR-0020).
 *
 * This is **not** the vocabulary table ADR-0019 rejected. Roles are still
 * free-form strings, an unknown role is still not a validation error, and
 * nothing here is enforced by the gate: the four names below buy their
 * privilege the ordinary way, by being written into a new workflow's
 * `workflow_access` and a new human step's `allowedRoles` as the default the
 * author can see and change. A deployment that renames them, deletes them
 * from a workflow's lists or never grants them behaves exactly as it does
 * without this table.
 *
 * `workflow-manager` is deliberately the union of the other three rather than
 * a fourth privilege: ADR-0019 rules out role hierarchies, so "may do
 * everything to this workflow" has to be spelled out as the verbs it covers.
 */
export const BUILTIN_ROLES: readonly BuiltinRole[] = [
  {
    id: 'editor',
    label: 'Editor',
    description: 'Can change a workflow — save a version, archive, delete, transfer it.',
    verbs: ['edit'],
  },
  {
    id: 'executor',
    label: 'Executor',
    description: 'Can start runs of a workflow.',
    verbs: ['run'],
  },
  {
    id: 'reviewer',
    label: 'Reviewer',
    description: 'Can pick up and complete the manual steps of a run.',
    verbs: ['act'],
  },
  {
    id: 'workflow-manager',
    label: 'Workflow manager',
    description: 'Can run and change a workflow, and act on its manual steps.',
    verbs: ['run', 'edit', 'act'],
  },
];

/**
 * The role granted to a workspace owner when the workspace is created, and to
 * whoever registers a workflow, narrowed to that workflow.
 *
 * Both grants exist for the same reason: a default gate that nobody in the
 * workspace can pass is a lockout, not a default (AGENTS.md §13).
 */
export const WORKFLOW_MANAGER_ROLE = 'workflow-manager';

export function builtinRoleIds(): string[] {
  return BUILTIN_ROLES.map((role) => role.id);
}

export function builtinRolesWithVerb(verb: RoleVerb): string[] {
  return BUILTIN_ROLES.filter((role) => role.verbs.includes(verb)).map((role) => role.id);
}

export function findBuiltinRole(id: string): BuiltinRole | null {
  return BUILTIN_ROLES.find((role) => role.id === id) ?? null;
}

/**
 * What a workflow's Access tab starts out saying, seeded when a person
 * registers its first version.
 *
 * Derived from the table above rather than written twice, so adding a verb to
 * a role cannot leave the default disagreeing with the role's own description.
 *
 * Read-only by convention: this and `DEFAULT_STEP_ALLOWED_ROLES` below are one
 * shared value per process, so a consumer that persists or edits either must
 * copy it first.
 */
export const DEFAULT_WORKFLOW_ACCESS: WorkflowAccess = {
  run: builtinRolesWithVerb('run'),
  edit: builtinRolesWithVerb('edit'),
};

/** What a human step added in the editor starts out allowing. */
export const DEFAULT_STEP_ALLOWED_ROLES: string[] = builtinRolesWithVerb('act');

/**
 * Raise a workflow's access lists to the floor its built-in roles set: a
 * **gated** verb always admits the built-in roles that carry it.
 *
 * The Access tab shows these as locked chips, and this is what makes that
 * honest — the gate reads the stored list and nothing else, so a list the
 * screen says cannot drop `executor` has to actually contain it however it
 * was written (the CLI and the API reach the same storage).
 *
 * An **empty list is left empty**. That is "any workspace member", the state
 * of every workflow that predates ADR-0020 and of every one registered by
 * automation, and raising it to a floor would gate what is open today
 * (AGENTS.md §12) — the one change this must never make.
 *
 * The consequence is deliberate and is the cost of the guarantee: a workflow
 * cannot be restricted to `qa-lead` *instead of* the built-ins, only in
 * addition to them. Excluding an `executor` from one workflow means not
 * granting them `executor`.
 */
export function withBuiltinAccessFloor(access: WorkflowAccess): WorkflowAccess {
  return {
    run: raiseToFloor(access.run, 'run'),
    edit: raiseToFloor(access.edit, 'edit'),
  };
}

/** The roles a gated `verb` always admits, in the order the Access tab shows them. */
export function pinnedRolesForVerb(verb: RoleVerb): string[] {
  return builtinRolesWithVerb(verb);
}

/**
 * The same floor for a **restricted human step**: `workflow-manager` can act on
 * one whatever its author wrote.
 *
 * Applied where the gate reads rather than written into the list, unlike
 * `run` / `edit` above. `step.allowedRoles` is authored data inside a versioned
 * document that travels between deployments (ADR-0013) — rewriting it would
 * put this platform's vocabulary into somebody else's workflow package, and
 * would not reach the imported package naming `engineer` that is exactly the
 * case this exists for.
 *
 * **Only `workflow-manager`**, though `reviewer` carries `act` too. `reviewer`
 * is an ordinary process role that 23 definitions in this repo already name in
 * `allowedRoles`; giving it standing authority would let somebody granted it
 * for one step claim every other one — a privilege escalation on existing
 * grants (AGENTS.md §12). `workflow-manager` is a name this platform
 * introduced, held by nobody before it existed, and "can act on its manual
 * steps" is what it says it means. `reviewer` keeps its `act` verb where it is
 * honest: as the role a new human step is seeded to allow.
 *
 * An empty list is left empty — no `allowedRoles` is "any workspace member",
 * and a floor there would gate a step that is open today.
 */
export function withBuiltinStepFloor(allowedRoles: readonly string[]): string[] {
  if (allowedRoles.length === 0) return [];
  return [...new Set([...allowedRoles, WORKFLOW_MANAGER_ROLE])];
}

function raiseToFloor(roles: readonly string[], verb: RoleVerb): string[] {
  if (roles.length === 0) return [];
  return [...new Set([...pinnedRolesForVerb(verb), ...roles])];
}
