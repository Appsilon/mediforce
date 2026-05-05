import { z } from 'zod';

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
