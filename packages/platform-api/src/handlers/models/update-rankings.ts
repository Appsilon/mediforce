import type { ModelRegistryRepository } from '@mediforce/platform-core';
import type { UpdateRankingsInput, UpdateRankingsOutput } from '../../contract/models.js';

export interface UpdateRankingsDeps {
  modelRegistryRepo: ModelRegistryRepository;
}

export async function updateRankings(
  input: UpdateRankingsInput,
  deps: UpdateRankingsDeps,
): Promise<UpdateRankingsOutput> {
  const updated = await deps.modelRegistryRepo.updateRankings(input.rankings);
  const meta = await deps.modelRegistryRepo.getMeta();
  return {
    updated,
    rankingsUpdatedAt: meta.rankingsUpdatedAt ?? new Date().toISOString(),
  };
}
