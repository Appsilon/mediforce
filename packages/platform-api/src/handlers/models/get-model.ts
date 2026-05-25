import type { ModelRegistryRepository } from '@mediforce/platform-core';
import { ApiError } from '../../errors.js';
import type { GetModelInput, GetModelOutput } from '../../contract/models.js';

export interface GetModelDeps {
  modelRegistryRepo: ModelRegistryRepository;
}

/**
 * @public-handler  Model registry is platform-wide, not namespaced.
 *
 * TODO(ADR-0004 follow-up): migrate to the `(input, scope)` signature via
 * `scope.models` (a deployment-global pass-through). Today this handler and
 * its `models/` siblings keep the legacy `(input, deps)` shape — the only
 * exception to the uniform handler contract in §3.
 */
export async function getModel(
  input: GetModelInput,
  deps: GetModelDeps,
): Promise<GetModelOutput> {
  const model = await deps.modelRegistryRepo.getById(input.id);
  if (!model) {
    throw new ApiError('not_found', `Model '${input.id}' not found in registry`);
  }
  return { model };
}
