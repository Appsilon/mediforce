import { z } from 'zod';
import { ModelRegistryEntrySchema, ModelRegistryMetaSchema, UpdateRankingsInputSchema } from '@mediforce/platform-core';

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
  retired: z.number(),
  reinstated: z.number(),
  rankingsUpdated: z.number(),
  lastSyncedAt: z.string(),
});

export type SyncModelsOutput = z.infer<typeof SyncModelsOutputSchema>;

export { UpdateRankingsInputSchema };
export type UpdateRankingsInput = z.infer<typeof UpdateRankingsInputSchema>;

export const UpdateRankingsOutputSchema = z.object({
  updated: z.number(),
  rankingsUpdatedAt: z.string(),
});

export type UpdateRankingsOutput = z.infer<typeof UpdateRankingsOutputSchema>;

export const GetMetaOutputSchema = z.object({
  meta: ModelRegistryMetaSchema,
});

export type GetMetaOutput = z.infer<typeof GetMetaOutputSchema>;

export const ValidateModelsInputSchema = z.object({
  modelIds: z.array(z.string().min(1)).min(1),
});

export type ValidateModelsInput = z.infer<typeof ValidateModelsInputSchema>;

export const ValidateModelsOutputSchema = z.object({
  unknown: z.array(
    z.object({
      id: z.string(),
      suggestion: z.string().nullable(),
    }),
  ),
});

export type ValidateModelsOutput = z.infer<typeof ValidateModelsOutputSchema>;
