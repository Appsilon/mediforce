import { DEFAULT_WORKFLOW_ACCESS, WORKFLOW_MANAGER_ROLE } from '@mediforce/platform-core';
import { emitAudit } from '../../audit-helpers';
import type { CallerScope } from '../../repositories/index';

/**
 * Give a brand-new workflow the default `run` / `edit` lists, and make the
 * person who created it a `workflow-manager` on it (ADR-0020).
 *
 * The two writes are one act, not two features. The default gate names
 * `executor` / `editor` / `workflow-manager`, none of which its author
 * necessarily holds — so seeding the lists alone would hand somebody a
 * workflow they had just been locked out of, refused on their own second Save.
 * The narrowed grant is what makes the default a default rather than a wall,
 * and it is a grant like any other: it shows up in the Roles table, an admin
 * can revoke it, and it dies with the workflow through the same cascade every
 * narrowed grant does.
 *
 * Only on **v1**, and only for a **user** caller:
 *
 * - v2 must not re-seed — the lists are the admin's after that, and an empty
 *   pair is a deliberate "open to every member", not an unconfigured one.
 * - A system actor has no uid to grant, so seeding for one would gate a
 *   workflow on roles nobody in the workspace holds. Automation-registered
 *   workflows (the CLI, imports run by an agent, seeded builtins) therefore
 *   stay open, exactly as they are today.
 *
 * The grant is what licenses the gate, so a failure to write it skips the
 * gate too rather than leaving half of the pair. A deployment that wires no
 * user directory cannot hold roles at all, and gets no default gate for the
 * same reason: an unusable workflow is worse than an ungated one, and the
 * registration itself has already succeeded by this point.
 */
export async function seedDefaultWorkflowAccess(
  scope: CallerScope,
  namespace: string,
  workflowName: string,
): Promise<void> {
  const { caller, system } = scope;
  if (caller.kind !== 'user') return;
  if (system.userDirectory === null) return;

  try {
    await system.userDirectory.grantRole(caller.uid, namespace, {
      role: WORKFLOW_MANAGER_ROLE,
      workflowName,
    });
  } catch {
    return;
  }
  // Copied, not passed by reference: the constant is shared process-wide and a
  // repository that keeps what it is handed would let one workflow's later
  // edit rewrite the default every other workflow is seeded with.
  await scope.workflowDefinitions.setAccess(namespace, workflowName, {
    run: [...DEFAULT_WORKFLOW_ACCESS.run],
    edit: [...DEFAULT_WORKFLOW_ACCESS.edit],
  });

  await emitAudit(system.audit, caller, {
    action: 'workflow.access_changed',
    description:
      `Workflow '${workflowName}' seeded with the default access: ` +
      `run: [${DEFAULT_WORKFLOW_ACCESS.run.join(', ')}], ` +
      `edit: [${DEFAULT_WORKFLOW_ACCESS.edit.join(', ')}]`,
    inputSnapshot: { namespace, name: workflowName },
    outputSnapshot: {
      access: DEFAULT_WORKFLOW_ACCESS,
      grantedToCreator: `${WORKFLOW_MANAGER_ROLE}@${workflowName}`,
    },
    basis: 'Default workflow access seeded on first registration',
    entityType: 'workflow_definition',
    entityId: workflowName,
    namespace,
  });
}
