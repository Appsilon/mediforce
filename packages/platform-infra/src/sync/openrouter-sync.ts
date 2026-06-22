import type { ModelRegistryRepository, CreateModelRegistryEntryInput } from '@mediforce/platform-core';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

interface OpenRouterModel {
  id: string;
  canonical_slug?: string;
  name: string;
  context_length: number;
  architecture: {
    modality: string;
    input_modalities: string[];
    output_modalities: string[];
  };
  pricing: {
    prompt: string;
    completion: string;
    input_cache_read?: string;
  };
  top_provider: {
    context_length: number;
    max_completion_tokens: number | null;
  };
  supported_parameters: string[];
  requests?: number;
}

export interface SyncResult {
  synced: number;
  total: number;
  retired: number;
  reinstated: number;
  rankingsUpdated: number;
  lastSyncedAt: string;
}

function parsePrice(raw: string | undefined | null): number {
  if (raw === undefined || raw === null || raw === '') return 0;
  const value = parseFloat(raw);
  if (Number.isNaN(value) || value < 0) return 0;
  return value;
}

function transformModel(model: OpenRouterModel): CreateModelRegistryEntryInput {
  const provider = model.id.split('/')[0];
  return {
    id: model.id,
    canonicalSlug: model.canonical_slug ?? null,
    name: model.name,
    provider,
    contextLength: model.context_length,
    maxCompletionTokens: model.top_provider?.max_completion_tokens ?? null,
    pricing: {
      input: parsePrice(model.pricing.prompt),
      output: parsePrice(model.pricing.completion),
      ...(model.pricing.input_cache_read ? { cacheRead: parsePrice(model.pricing.input_cache_read) } : {}),
    },
    modality: model.architecture?.modality ?? 'text->text',
    inputModalities: model.architecture?.input_modalities ?? ['text'],
    outputModalities: model.architecture?.output_modalities ?? ['text'],
    supportsTools: model.supported_parameters?.includes('tools') ?? false,
    supportsVision: model.architecture?.input_modalities?.includes('image') ?? false,
    source: 'openrouter' as const,
    requestCount: null,
    lastSyncedAt: new Date().toISOString(),
    retiredAt: null,
  };
}

export async function syncFromOpenRouter(repo: ModelRegistryRepository): Promise<SyncResult> {
  const response = await fetch(OPENROUTER_MODELS_URL, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`OpenRouter API returned ${response.status}: ${response.statusText}`);
  }
  const json = await response.json();
  const models: OpenRouterModel[] = Array.isArray(json) ? json : json.data;
  if (!Array.isArray(models)) {
    throw new Error('Unexpected OpenRouter response shape: expected array of models');
  }

  const entries = models.map(transformModel);
  const synced = await repo.bulkUpsert(entries);

  // Retire absent models and reinstate returned ones
  const syncedIds = entries.map((e) => e.id);
  const { retired, reinstated } = await repo.retireAbsentModels(syncedIds);

  // Update rankings from request counts in the OpenRouter response
  const rankings = models
    .filter((m) => typeof m.requests === 'number' && m.requests > 0)
    .map((m) => ({ id: m.id, requestCount: m.requests as number }));
  const rankingsUpdated = rankings.length > 0 ? await repo.updateRankings(rankings) : 0;

  const lastSyncedAt = new Date().toISOString();
  return { synced, total: models.length, retired, reinstated, rankingsUpdated, lastSyncedAt };
}

export async function syncWithRetry(
  repo: ModelRegistryRepository,
  opts: {
    maxRetries?: number;
    intervalMs?: number;
    onAttemptFail?: (attempt: number, error: Error) => void | Promise<void>;
  } = {},
): Promise<SyncResult> {
  const { maxRetries = 3, intervalMs = 3_600_000, onAttemptFail } = opts;
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await syncFromOpenRouter(repo);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt <= maxRetries) {
        console.log(
          `[model-sync] Attempt ${attempt} failed: ${lastError.message}. Retrying in ${intervalMs / 1000}s...`,
        );
        await onAttemptFail?.(attempt, lastError);
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
  }
  throw lastError;
}
