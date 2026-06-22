import { z } from 'zod';

export const PluginRoleSchema = z.enum(['executor', 'reviewer']);

export const PluginCapabilityMetadataSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputDescription: z.string(),
  outputDescription: z.string(),
  roles: z.array(PluginRoleSchema).min(1),
  foundationModel: z.string().optional(),
  /** Env vars the plugin implicitly needs inside the container.
   *  Each inner array is one alternative group — ALL keys in a group
   *  must be present. At least ONE group must be fully satisfied.
   *  Example: `[['ANTHROPIC_API_KEY'], ['OPENROUTER_API_KEY', 'ANTHROPIC_BASE_URL']]`
   *  means the plugin needs ANTHROPIC_API_KEY *or* both OPENROUTER_API_KEY and
   *  ANTHROPIC_BASE_URL. */
  requiredEnv: z.array(z.array(z.string())).optional(),
});

export type PluginCapabilityMetadata = z.infer<typeof PluginCapabilityMetadataSchema>;
