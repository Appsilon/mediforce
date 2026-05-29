import type {
  ArchiveAllInput,
  ArchiveAllOutput,
  ArchiveVersionInput,
  ArchiveVersionOutput,
} from '../../contract/workflows.js';
import type { CallerScope } from '../../repositories/index.js';
import { NotFoundError } from '../../errors.js';
import { actorFromCaller } from '../_helpers.js';

interface ArchiveAllScoped extends ArchiveAllInput {
  namespace: string;
}

interface ArchiveVersionScoped extends ArchiveVersionInput {
  namespace: string;
}

export async function archiveWorkflow(
  input: ArchiveAllScoped,
  scope: CallerScope,
): Promise<ArchiveAllOutput> {
  const latestVersion = await scope.workflowDefinitions.getLatestVersion(
    input.namespace,
    input.name,
  );
  if (latestVersion === 0) throw new NotFoundError(`Workflow '${input.name}' not found`);

  await scope.workflowDefinitions.setArchived(input.namespace, input.name, input.archived);

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: input.archived ? 'workflow.archived' : 'workflow.unarchived',
    description: `Workflow '${input.name}' ${input.archived ? 'archived' : 'unarchived'}`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { namespace: input.namespace, name: input.name },
    outputSnapshot: { archived: input.archived },
    basis: 'Workflow archive flag toggled via API',
    entityType: 'workflow_definition',
    entityId: input.name,
    namespace: input.namespace,
  });

  return { success: true as const, name: input.name, archived: input.archived };
}

export async function archiveWorkflowVersion(
  input: ArchiveVersionScoped,
  scope: CallerScope,
): Promise<ArchiveVersionOutput> {
  // Wrapper throws raw error from infra layer when version is missing; surface
  // as NotFoundError for consistency with the legacy inline route.
  try {
    await scope.workflowDefinitions.setVersionArchived(
      input.namespace,
      input.name,
      input.version,
      input.archived,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (/not found/i.test(message)) throw new NotFoundError(message);
    throw err;
  }

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: input.archived ? 'workflow.version_archived' : 'workflow.version_unarchived',
    description: `Workflow '${input.name}' v${input.version} ${input.archived ? 'archived' : 'unarchived'}`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { namespace: input.namespace, name: input.name, version: input.version },
    outputSnapshot: { archived: input.archived },
    basis: 'Workflow version archive flag toggled via API',
    entityType: 'workflow_definition',
    entityId: input.name,
    namespace: input.namespace,
  });

  return {
    success: true as const,
    name: input.name,
    version: input.version,
    archived: input.archived,
  };
}
