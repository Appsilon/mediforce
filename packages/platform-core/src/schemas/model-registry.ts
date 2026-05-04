import { z } from 'zod';

export const ModelRegistryEntrySchema = z.object({
  id: z.string(),
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
  lastSyncedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ModelRegistryEntry = z.infer<typeof ModelRegistryEntrySchema>;

export const CreateModelRegistryEntryInputSchema = ModelRegistryEntrySchema.omit({
  createdAt: true,
  updatedAt: true,
});

export type CreateModelRegistryEntryInput = z.infer<typeof CreateModelRegistryEntryInputSchema>;

export const UpdateModelRegistryEntryInputSchema = CreateModelRegistryEntryInputSchema.partial().required({ id: true });

export type UpdateModelRegistryEntryInput = z.infer<typeof UpdateModelRegistryEntryInputSchema>;
