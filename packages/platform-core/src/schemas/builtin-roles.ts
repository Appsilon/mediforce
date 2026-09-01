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
