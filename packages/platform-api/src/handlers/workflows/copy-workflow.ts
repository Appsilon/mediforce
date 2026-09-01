import type {
  CopyWorkflowInput,
  CopyWorkflowOutput,
} from '../../contract/workflows';
import type { CallerScope } from '../../repositories/index';
import { ConflictError, NotFoundError } from '../../errors';
import { actorFromCaller } from '../_helpers';
import { seedManualTrigger } from './_seed-triggers';

interface ScopedInput extends CopyWorkflowInput {
  targetNamespace: string;
  sourceNamespace?: string;
}

/**
 * Cross-namespace copy. Per ADR-0004 §5 the handler does two scope-mediated
 * calls: read the source (visibility-gated — public sources are copyable even
 * by non-members) and write to the target (membership-gated). No wrapper
 * shortcut.
 *
 * Copying is not gated by the source's `run` / `edit` roles (ADR-0019): the
 * copy is a new workflow, and refusing the copy would take away a capability
 * `visibility: public` exists to grant. What the copy must not do is *launder*
 * the gate — a member refused `run` on `payments` could otherwise copy it to
 * `payments-2` in the same workspace and start that instead. So a copy that
 * stays inside the workspace inherits the source's access; see below.
 */
export async function copyWorkflow(
  input: ScopedInput,
  scope: CallerScope,
): Promise<CopyWorkflowOutput> {
  const sourceNamespace = input.sourceNamespace ?? input.targetNamespace;

  const sourceVersion =
    input.version ?? (await scope.workflowDefinitions.getLatestVersion(sourceNamespace, input.name));
  if (sourceVersion === 0) {
    throw new NotFoundError(`Workflow '${input.name}' not found`);
  }

  const source = await scope.workflowDefinitions.get(sourceNamespace, input.name, sourceVersion);
  if (source === null) {
    throw new NotFoundError(`Workflow '${input.name}' version ${sourceVersion} not found`);
  }

  const copyName = input.targetName ?? input.name;
  const existingTargetVersion = await scope.workflowDefinitions.getLatestVersion(
    input.targetNamespace,
    copyName,
  );
  if (existingTargetVersion > 0) {
    throw new ConflictError(
      `Workflow '${copyName}' already exists in namespace '${input.targetNamespace}'`,
    );
  }

  const copiedFrom = {
    namespace: source.namespace,
    name: source.name,
    version: source.version,
  };

  // Doc IDs are namespace-scoped ({namespace}:{name}:{version}); copies start
  // fresh at version 1 of the target.
  const nextVersion = 1;

  await scope.workflowDefinitions.save({
    ...source,
    name: copyName,
    namespace: input.targetNamespace,
    version: nextVersion,
    visibility: 'private',
    copiedFrom,
    createdAt: new Date().toISOString(),
    archived: undefined,
    deleted: undefined,
  });

  // ADR-0019: a copy that stays in the workspace is the same process under a
  // second name, so it inherits the source's `run` / `edit` roles — otherwise
  // copying is a one-call bypass of the gate this workspace just configured.
  // A copy that *leaves* carries nothing, for the reason `transferWorkflow`
  // clears them: a role name means different people in another workspace, and
  // the destination's admins own what happens there. An ungated source copies
  // to an ungated target either way, which is every copy made today.
  if (sourceNamespace === input.targetNamespace) {
    const sourceAccess = await scope.workflowDefinitions.getAccess(sourceNamespace, input.name);
    await scope.workflowDefinitions.setAccess(input.targetNamespace, copyName, sourceAccess);
  }

  // ADR-0011: seed the detached manual singleton for the copy so it stays
  // hand-startable — the guard reads the table, not the copied definition.
  // Cron/webhook triggers are not copied; they are independent resources
  // created via the triggers table (Issue #932).
  await seedManualTrigger(scope, input.targetNamespace, copyName);

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'workflow.copied',
    description: `Workflow '${input.name}' copied to '${input.targetNamespace}/${copyName}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { source: copiedFrom, target: { namespace: input.targetNamespace, name: copyName } },
    outputSnapshot: { name: copyName, version: nextVersion },
    basis: 'Workflow copied via API',
    entityType: 'workflow_definition',
    entityId: copyName,
    namespace: input.targetNamespace,
  });

  return {
    success: true as const,
    name: copyName,
    version: nextVersion,
    copiedFrom,
  };
}
