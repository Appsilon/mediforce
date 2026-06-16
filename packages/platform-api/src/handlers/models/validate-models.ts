import type { ModelRegistryRepository } from '@mediforce/platform-core';
import type { ValidateModelsInput, ValidateModelsOutput } from '../../contract/models';

export interface ValidateModelsDeps {
  modelRegistryRepo: ModelRegistryRepository;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function normaliseModelId(raw: string): string {
  if (raw.includes('/')) return raw;
  const idx = raw.indexOf('__');
  return idx < 0 ? raw : `${raw.slice(0, idx)}/${raw.slice(idx + 2)}`;
}

function findSuggestion(unknownId: string, knownIds: string[]): string | null {
  const normalised = normaliseModelId(unknownId).toLowerCase();
  let best: string | null = null;
  let bestDist = Infinity;

  for (const known of knownIds) {
    const knownLower = known.toLowerCase();
    if (knownLower.includes(normalised) || normalised.includes(knownLower)) {
      return known;
    }
    const dist = levenshtein(normalised, knownLower);
    if (dist < bestDist) {
      bestDist = dist;
      best = known;
    }
  }

  const maxLen = Math.max(normalised.length, best?.length ?? 0);
  if (best !== null && bestDist <= maxLen * 0.4) {
    return best;
  }
  return null;
}

export async function validateModels(
  input: ValidateModelsInput,
  deps: ValidateModelsDeps,
): Promise<ValidateModelsOutput> {
  const allModels = await deps.modelRegistryRepo.list();
  const knownIds = new Set(allModels.map((m) => m.id));
  const knownIdList = allModels.map((m) => m.id);

  const unknown: ValidateModelsOutput['unknown'] = [];

  for (const id of input.modelIds) {
    const normalised = normaliseModelId(id);
    if (knownIds.has(normalised) || knownIds.has(id)) continue;
    unknown.push({
      id,
      suggestion: findSuggestion(id, knownIdList),
    });
  }

  return { unknown };
}
