import { z } from 'zod';
import { ModelRegistryEntrySchema } from '@mediforce/platform-core';

export const ListModelsInputSchema = z
  .object({
    provider: z.string().optional(),
    supportsTools: z.coerce.boolean().optional(),
    supportsVision: z.coerce.boolean().optional(),
    minContextLength: z.coerce.number().optional(),
  })
  .optional();

export type ListModelsInput = z.infer<typeof ListModelsInputSchema>;

export const ListModelsOutputSchema = z.object({
  models: z.array(ModelRegistryEntrySchema),
});

export type ListModelsOutput = z.infer<typeof ListModelsOutputSchema>;

export const GetModelInputSchema = z.object({
  id: z.string().min(1),
});

export type GetModelInput = z.infer<typeof GetModelInputSchema>;

export const GetModelOutputSchema = z.object({
  model: ModelRegistryEntrySchema,
});

export type GetModelOutput = z.infer<typeof GetModelOutputSchema>;

export const SyncModelsOutputSchema = z.object({
  synced: z.number(),
  total: z.number(),
  lastSyncedAt: z.string(),
});

export type SyncModelsOutput = z.infer<typeof SyncModelsOutputSchema>;
