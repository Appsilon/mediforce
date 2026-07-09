import type { ModelRegistryRepository } from '@mediforce/platform-core';
import { syncFromOpenRouter } from '@mediforce/platform-infra';
import type { SyncModelsOutput } from '../../contract/models';

export interface SyncModelsDeps {
  modelRegistryRepo: ModelRegistryRepository;
}

/** @public-handler  Model registry is platform-wide; sync is an admin operation. */
export async function syncModels(deps: SyncModelsDeps): Promise<SyncModelsOutput> {
  return await syncFromOpenRouter(deps.modelRegistryRepo);
}
