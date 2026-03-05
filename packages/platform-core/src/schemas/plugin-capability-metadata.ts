import { z } from 'zod';

export const PluginRoleSchema = z.enum(['executor', 'reviewer']);

export const PluginCapabilityMetadataSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputDescription: z.string(),
  outputDescription: z.string(),
  roles: z.array(PluginRoleSchema).min(1),
});

export type PluginCapabilityMetadata = z.infer<typeof PluginCapabilityMetadataSchema>;
