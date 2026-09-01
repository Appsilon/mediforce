import { withBuiltinAccessFloor } from '@mediforce/platform-core';
import type {
  GetWorkflowAccessInput,
  GetWorkflowAccessOutput,
  SetWorkflowAccessInput,
  SetWorkflowAccessOutput,
} from '../../contract/workflows';
import { assertCallerIsNamespaceAdmin } from '../../auth';
import { emitAudit } from '../../audit-helpers';
import { NotFoundError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import { resolveCallerWorkflowVerbs } from './_access-gate';

/**
 * Read one workflow's `run` / `edit` role lists, plus what they mean for the
 * caller (ADR-0019, issue #1253).
 *
 * Readable by any member of the workspace, not just owner/admin: the Access
 * tab is where a member finds out *why* their Start button is disabled, and a
 * 403 there would answer that question with silence. Writing is
 * admin-only — see `setWorkflowAccess`.
 *
 * `caller` is resolved through the same predicate the gates enforce, so the
 * screen and the refusal cannot disagree.
 */
export async function getWorkflowAccess(
  input: GetWorkflowAccessInput,
  scope: CallerScope,
): Promise<GetWorkflowAccessOutput> {
  await assertWorkflowExists(input.namespace, input.name, scope);

  const access = await scope.workflowDefinitions.getAccess(input.namespace, input.name);
  const caller = await resolveCallerWorkflowVerbs(
    scope.caller,
    scope.system.userDirectory,
    input.namespace,
    input.name,
    access,
  );

  return { namespace: input.namespace, name: input.name, access, caller };
}

/**
 * Replace both role lists in one write. Owner/admin only.
 *
 * Administering workflow access is a Membership privilege (ADR-0019): the
 * platform has no workflow-ownership concept and `WorkflowDefinition` carries
 * no `createdBy` to build one from. Note this means holding `edit` does not
 * let you widen your own gate — changing who may edit is an admin's act, and
 * an `edit` holder who could rewrite the list would be an admin by another
 * name.
 *
 * Roles stay free-form strings, so a list naming a role nobody holds is not a
 * validation error here — it is a legitimate authoring order, and the Access
 * tab warns about it beside the members who hold each role.
 *
 * A **gated** list is raised to its built-in floor before it is stored
 * (ADR-0020): restricting `run` at all still admits `executor` and
 * `workflow-manager`. Normalised here rather than validated, because a refusal
 * would make the CLI and the API answer differently from the tab, which cannot
 * express the state being refused. An empty list is left empty — that is "any
 * member", and raising it would gate what is open.
 */
export async function setWorkflowAccess(
  input: SetWorkflowAccessInput,
  scope: CallerScope,
): Promise<SetWorkflowAccessOutput> {
  assertCallerIsNamespaceAdmin(scope.caller, input.namespace);
  await assertWorkflowExists(input.namespace, input.name, scope);

  const previous = await scope.workflowDefinitions.getAccess(input.namespace, input.name);
  const access = withBuiltinAccessFloor(input.access);
  await scope.workflowDefinitions.setAccess(input.namespace, input.name, access);

  await emitAudit(scope.system.audit, scope.caller, {
    action: 'workflow.access_changed',
    description:
      `Workflow '${input.name}' access set to ` +
      `run: [${describe(access.run)}], edit: [${describe(access.edit)}]`,
    inputSnapshot: { namespace: input.namespace, name: input.name, access: input.access },
    outputSnapshot: { previousAccess: previous },
    basis: 'Owner/admin set workflow run/edit access via API',
    entityType: 'workflow_definition',
    entityId: input.name,
    namespace: input.namespace,
  });

  // The stored value, not the requested one: the floor may have added roles,
  // and a screen that rendered its own request back would show a list the gate
  // does not enforce until the next reload.
  const caller = await resolveCallerWorkflowVerbs(
    scope.caller,
    scope.system.userDirectory,
    input.namespace,
    input.name,
    access,
  );
  return { namespace: input.namespace, name: input.name, access, caller };
}

/**
 * 404 for a workflow that does not exist, so access cannot be written for a
 * name nothing answers to — an invisible row that would silently take effect
 * the day someone registers it, which is the failure the ADR's cascades exist
 * to prevent, arriving from the other direction.
 */
async function assertWorkflowExists(
  namespace: string,
  name: string,
  scope: CallerScope,
): Promise<void> {
  const latestVersion = await scope.workflowDefinitions.getLatestVersion(namespace, name);
  if (latestVersion === 0) throw new NotFoundError(`Workflow '${name}' not found`);
}

function describe(roles: readonly string[]): string {
  return roles.length === 0 ? 'any member' : roles.join(', ');
}
