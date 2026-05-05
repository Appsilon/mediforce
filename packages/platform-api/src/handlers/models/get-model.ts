import type { ModelRegistryRepository } from '@mediforce/platform-core';
import type { GetModelInput, GetModelOutput } from '../../contract/models.js';

export interface GetModelDeps {
  modelRegistryRepo: ModelRegistryRepository;
}

export async function getModel(
  input: GetModelInput,
  deps: GetModelDeps,
): Promise<GetModelOutput> {
  const model = await deps.modelRegistryRepo.getById(input.id);
  if (!model) {
    throw new Error(`Model '${input.id}' not found in registry`);
  }
  return { model };
}
