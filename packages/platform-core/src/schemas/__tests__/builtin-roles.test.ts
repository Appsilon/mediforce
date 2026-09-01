import { describe, it, expect } from 'vitest';
import {
  BUILTIN_ROLES,
  withBuiltinAccessFloor,
  DEFAULT_STEP_ALLOWED_ROLES,
  DEFAULT_WORKFLOW_ACCESS,
  WORKFLOW_MANAGER_ROLE,
  builtinRoleIds,
  findBuiltinRole,
} from '../builtin-roles';

/**
 * The built-in roles and the defaults derived from them (ADR-0020).
 *
 * The cases here are the invariants other code assumes rather than a copy of
 * the table: a test asserting that `editor` is spelled `editor` would only
 * ever break when someone meant to change it.
 */
describe('built-in roles', () => {
  it('gives workflow-manager every verb the other roles split between them', () => {
    // Load-bearing in two places that have no other guard: the grant a
    // workspace owner gets, and the one a workflow's author gets. Both exist
    // to pass the seeded `run` and `edit` lists, so a workflow-manager missing
    // a verb is a lockout rather than a missing feature.
    const covered = [...new Set(BUILTIN_ROLES.flatMap((role) => role.verbs))].sort();
    const manager = findBuiltinRole(WORKFLOW_MANAGER_ROLE)?.verbs ?? [];
    expect([...manager].sort()).toEqual(covered);
  });

  it('names only built-in roles in the defaults it seeds', () => {
    // The vocabulary pick-list is the union of the built-ins with what the
    // workspace already knows, so a default naming a role outside the table
    // would be quoted by a gate the editor never suggests.
    const seeded = [
      ...DEFAULT_WORKFLOW_ACCESS.run,
      ...DEFAULT_WORKFLOW_ACCESS.edit,
      ...DEFAULT_STEP_ALLOWED_ROLES,
    ];
    expect(seeded.filter((role) => !builtinRoleIds().includes(role))).toEqual([]);
  });

  it('derives each default from the verb its roles carry', () => {
    expect(DEFAULT_WORKFLOW_ACCESS.run).toEqual(['executor', 'workflow-manager']);
    expect(DEFAULT_WORKFLOW_ACCESS.edit).toEqual(['editor', 'workflow-manager']);
    expect(DEFAULT_STEP_ALLOWED_ROLES).toEqual(['reviewer', 'workflow-manager']);
  });

  it('has no answer for a role it does not define', () => {
    expect(findBuiltinRole('biostatistician')).toBeNull();
  });
});

describe('withBuiltinAccessFloor', () => {
  it('leaves an unrestricted verb open', () => {
    // The one thing this must never do: raising an empty list would gate every
    // workflow that predates ADR-0020 and every one automation registers.
    expect(withBuiltinAccessFloor({ run: [], edit: [] })).toEqual({ run: [], edit: [] });
  });

  it('adds the verb’s built-in roles to a list that restricts', () => {
    expect(withBuiltinAccessFloor({ run: ['qa-lead'], edit: [] })).toEqual({
      run: ['executor', 'workflow-manager', 'qa-lead'],
      edit: [],
    });
  });

  it('raises each verb only to its own roles', () => {
    // `editor` has no business in a `run` list — the floor is per verb, not a
    // block of every built-in name.
    const raised = withBuiltinAccessFloor({ run: ['qa-lead'], edit: ['qa-lead'] });

    expect(raised.run).not.toContain('editor');
    expect(raised.edit).not.toContain('executor');
  });

  it('does not duplicate a built-in the list already names', () => {
    expect(withBuiltinAccessFloor({ run: ['workflow-manager', 'executor'], edit: [] }).run)
      .toEqual(['executor', 'workflow-manager']);
  });
});
