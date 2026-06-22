import type { CallerScope } from '../../repositories/index';
import { NotFoundError } from '../../errors';
import type {
  ListWorkflowVersionsInput,
  ListWorkflowVersionsOutput,
  WorkflowVersionSummary,
} from '../../contract/workflows';

/**
 * List every version of a workflow as metadata-only summaries (number,
 * archived flag, title, description, step + trigger counts, createdAt) plus
 * the namespace's pinned default version. Callers that need the full
 * definition for one specific version still call `getWorkflow(name, version)`.
 *
 * Visibility gating mirrors `getWorkflow`: members see every version;
 * non-members see public-latest workflows only; system actors bypass. An
 * empty result (unknown name OR caller cannot see any version) collapses to
 * 404 — same anti-enumeration stance as `get`.
 */
export async function listWorkflowVersions(
  input: ListWorkflowVersionsInput,
  scope: CallerScope,
): Promise<ListWorkflowVersionsOutput> {
  const definitions = await scope.workflowDefinitions.listVersions(input.namespace, input.name);

  if (definitions.length === 0) {
    throw new NotFoundError(`Workflow '${input.name}' not found`);
  }

  const versions: WorkflowVersionSummary[] = definitions.map((definition) => ({
    version: definition.version,
    archived: definition.archived ?? false,
    title: definition.title,
    description: definition.description,
    stepCount: definition.steps.length,
    triggerCount: definition.triggers.length,
    createdAt: definition.createdAt,
  }));

  const defaultVersion = await scope.workflowDefinitions.getDefaultVersion(input.namespace, input.name);

  return { versions, defaultVersion };
}
