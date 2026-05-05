import type { ModelRegistryRepository, CreateModelRegistryEntryInput } from '@mediforce/platform-core';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

interface OpenRouterModel {
  id: string;
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
    name: model.name,
    provider,
    contextLength: model.context_length,
    maxCompletionTokens: model.top_provider?.max_completion_tokens ?? null,
    pricing: {
      input: parsePrice(model.pricing.prompt),
      output: parsePrice(model.pricing.completion),
      ...(model.pricing.input_cache_read
        ? { cacheRead: parsePrice(model.pricing.input_cache_read) }
        : {}),
    },
    modality: model.architecture?.modality ?? 'text->text',
    inputModalities: model.architecture?.input_modalities ?? ['text'],
    outputModalities: model.architecture?.output_modalities ?? ['text'],
    supportsTools: model.supported_parameters?.includes('tools') ?? false,
    supportsVision: model.architecture?.input_modalities?.includes('image') ?? false,
    source: 'openrouter' as const,
    requestCount: null,
    lastSyncedAt: new Date().toISOString(),
  };
}

export async function syncFromOpenRouter(
  repo: ModelRegistryRepository,
): Promise<{ synced: number; total: number }> {
  const response = await fetch(OPENROUTER_MODELS_URL);
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
  return { synced, total: models.length };
}
