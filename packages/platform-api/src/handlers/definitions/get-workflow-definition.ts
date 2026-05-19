import type { ProcessRepository } from '@mediforce/platform-core';
import type { CallerIdentity } from '../../auth.js';
import { NotFoundError } from '../../errors.js';
import type {
  GetWorkflowDefinitionInput,
  GetWorkflowDefinitionOutput,
} from '../../contract/definitions.js';

export interface GetWorkflowDefinitionDeps {
  processRepo: ProcessRepository;
}

/**
 * Fetch one workflow definition by name (+ optional version, + optional
 * namespace filter). Public workflows are readable by any authenticated
 * caller; private workflows only by callers in the workflow's namespace.
 *
 * Visibility-denied responses use 404 (not 403) on purpose — acknowledging
 * existence of a private workflow would leak namespace information, so the
 * handler returns the same "not found" shape as a truly missing name.
 * Matches the pre-migration behaviour from
 * `app/api/workflow-definitions/[name]/route.ts`.
 */
export async function getWorkflowDefinition(
  input: GetWorkflowDefinitionInput,
  deps: GetWorkflowDefinitionDeps,
  caller: CallerIdentity,
): Promise<GetWorkflowDefinitionOutput> {
  const lookupNamespace = input.namespace ?? '';

  let version: number;
  if (input.version !== undefined) {
    version = input.version;
  } else {
    version = await deps.processRepo.getLatestWorkflowVersion(lookupNamespace, input.name);
    if (version === 0) {
      throw new NotFoundError(`Workflow '${input.name}' not found`);
    }
  }

  const definition = await deps.processRepo.getWorkflowDefinition(
    lookupNamespace,
    input.name,
    version,
  );
  if (definition === null) {
    throw new NotFoundError(`Workflow '${input.name}' not found`);
  }

  if (input.namespace !== undefined && definition.namespace !== input.namespace) {
    throw new NotFoundError(`Workflow '${input.name}' not found`);
  }

  if (caller.kind === 'apiKey') return { definition };
  if (definition.visibility === 'public') return { definition };
  if (caller.namespaces.has(definition.namespace)) {
    return { definition };
  }
  throw new NotFoundError(`Workflow '${input.name}' not found`);
}
