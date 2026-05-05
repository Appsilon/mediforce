import type { ModelRegistryRepository } from '@mediforce/platform-core';
import type { ListModelsInput, ListModelsOutput } from '../../contract/models.js';

export interface ListModelsDeps {
  modelRegistryRepo: ModelRegistryRepository;
}

export async function listModels(
  input: ListModelsInput | undefined,
  deps: ListModelsDeps,
): Promise<ListModelsOutput> {
  let models = await deps.modelRegistryRepo.list();

  if (input?.provider) {
    models = models.filter((m) => m.provider === input.provider);
  }
  if (input?.supportsTools !== undefined) {
    models = models.filter((m) => m.supportsTools === input.supportsTools);
  }
  if (input?.supportsVision !== undefined) {
    models = models.filter((m) => m.supportsVision === input.supportsVision);
  }
  if (input?.minContextLength !== undefined) {
    models = models.filter((m) => m.contextLength >= input.minContextLength!);
  }

  models.sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
  return { models };
}
