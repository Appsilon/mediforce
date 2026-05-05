import type { ModelRegistryRepository } from '@mediforce/platform-core';
import { syncFromOpenRouter } from '@mediforce/platform-infra';
import type { SyncModelsOutput } from '../../contract/models.js';

export interface SyncModelsDeps {
  modelRegistryRepo: ModelRegistryRepository;
}

export async function syncModels(deps: SyncModelsDeps): Promise<SyncModelsOutput> {
  const result = await syncFromOpenRouter(deps.modelRegistryRepo);
  return {
    ...result,
    lastSyncedAt: new Date().toISOString(),
  };
}
