import type { CallerScope } from '../../repositories/index.js';
import { ApiError } from '../../errors.js';
import type {
  GetWorkflowInput,
  GetWorkflowOutput,
} from '../../contract/workflows.js';

/**
 * Fetch one workflow definition by name (+ optional version, + optional
 * namespace filter). Workspace + visibility gating is enforced by the
 * `scope.workflowDefinitions` wrapper. Out-of-scope or private-not-allowed
 * collapses to 404 — same shape as a truly missing definition.
 */
export async function getWorkflow(
  input: GetWorkflowInput,
  scope: CallerScope,
): Promise<GetWorkflowOutput> {
  const lookupNamespace = input.namespace ?? '';

  let version: number;
  if (input.version !== undefined) {
    version = input.version;
  } else {
    version = await scope.workflowDefinitions.getLatestVersion(lookupNamespace, input.name);
    if (version === 0) {
      throw new ApiError('not_found', `Workflow '${input.name}' not found`);
    }
  }

  const definition = await scope.workflowDefinitions.get(lookupNamespace, input.name, version);
  if (definition === null) {
    throw new ApiError('not_found', `Workflow '${input.name}' not found`);
  }

  if (input.namespace !== undefined && definition.namespace !== input.namespace) {
    throw new ApiError('not_found', `Workflow '${input.name}' not found`);
  }

  return { definition };
}
