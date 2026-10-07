import { z } from 'zod';

/**
 * The model the platform picks for a call nobody saves (assistants, cowork
 * chat, voice synthesis): OpenRouter's alias for its newest Claude Sonnet, so a
 * new release is picked up without a code change. Never persist it on an Agent,
 * a workflow step or an Evaluator — the alias moves while the saved string does
 * not, so the step fingerprint and the scored Evaluator version would silently
 * stand for a different model. Save `pinDefaultModel(...)` instead.
 */
export const DEFAULT_MODEL = '~anthropic/claude-sonnet-latest';

/** The pinned default while the registry lists no Claude Sonnet (not synced, or unreachable). */
export const FALLBACK_PINNED_MODEL = 'anthropic/claude-sonnet-5.5';

const SONNET_ID = /^anthropic\/claude-sonnet-(\d+)(?:\.(\d+))?$/;

/**
 * OpenRouter's "newest of a family" aliases (`~anthropic/claude-sonnet-latest`)
 * change model under an unchanged id, so nothing qualified or scored may name one.
 */
export function isMovingModelAlias(modelId: string): boolean {
  return modelId.startsWith('~');
}

/**
 * The concrete model `DEFAULT_MODEL` stands for today: the newest live Claude
 * Sonnet the registry lists. A default that gets saved (a new agent, step or
 * judge) is pinned to this, so the definition keeps naming the model it was
 * qualified with when the alias moves on. `FALLBACK_PINNED_MODEL` when the
 * registry lists no Sonnet — never the alias.
 */
export function pinDefaultModel(models: ReadonlyArray<{ id: string; retiredAt: string | null }>): string {
  let newest: { id: string; major: number; minor: number } | null = null;
  for (const model of models) {
    if (model.retiredAt !== null) continue;
    const match = SONNET_ID.exec(model.id);
    if (match === null) continue;
    const major = Number(match[1]);
    const minor = Number(match[2] ?? 0);
    if (newest === null || major > newest.major || (major === newest.major && minor > newest.minor)) {
      newest = { id: model.id, major, minor };
    }
  }
  return newest?.id ?? FALLBACK_PINNED_MODEL;
}

export const ModelRegistryEntrySchema = z.object({
  id: z.string(),
  canonicalSlug: z.string().nullable(),
  name: z.string(),
  provider: z.string(),
  contextLength: z.number(),
  maxCompletionTokens: z.number().nullable(),
  pricing: z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number().optional(),
  }),
  modality: z.string(),
  inputModalities: z.array(z.string()),
  outputModalities: z.array(z.string()),
  supportsTools: z.boolean(),
  supportsVision: z.boolean(),
  source: z.enum(['openrouter', 'manual']),
  requestCount: z.number().nullable(),
  lastSyncedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  retiredAt: z.string().nullable(),
});

export const ModelRegistryMetaSchema = z.object({
  rankingsUpdatedAt: z.string().nullable(),
});

export type ModelRegistryEntry = z.infer<typeof ModelRegistryEntrySchema>;

export const CreateModelRegistryEntryInputSchema = ModelRegistryEntrySchema.omit({
  createdAt: true,
  updatedAt: true,
});

export type CreateModelRegistryEntryInput = z.infer<typeof CreateModelRegistryEntryInputSchema>;

export const UpdateModelRegistryEntryInputSchema = CreateModelRegistryEntryInputSchema.partial().required({ id: true });

export type UpdateModelRegistryEntryInput = z.infer<typeof UpdateModelRegistryEntryInputSchema>;

export type ModelRegistryMeta = z.infer<typeof ModelRegistryMetaSchema>;

export const UpdateRankingsInputSchema = z.object({
  rankings: z.array(z.object({
    id: z.string(),
    requestCount: z.number(),
  })),
});

export type UpdateRankingsInput = z.infer<typeof UpdateRankingsInputSchema>;
