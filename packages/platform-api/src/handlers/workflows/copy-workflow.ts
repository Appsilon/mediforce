import type {
  CopyWorkflowInput,
  CopyWorkflowOutput,
} from '../../contract/workflows';
import type { CallerScope } from '../../repositories/index';
import { ConflictError, NotFoundError } from '../../errors';
import { actorFromCaller } from '../_helpers';

interface ScopedInput extends CopyWorkflowInput {
  targetNamespace: string;
  sourceNamespace?: string;
}

/**
 * Cross-namespace copy. Per ADR-0004 §5 the handler does two scope-mediated
 * calls: read the source (visibility-gated — public sources are copyable even
 * by non-members) and write to the target (membership-gated). No wrapper
 * shortcut.
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
  });

  return {
    success: true as const,
    name: copyName,
    version: nextVersion,
    copiedFrom,
  };
}
