import { z } from 'zod';
import { PluginCapabilityMetadataSchema } from '@mediforce/platform-core';

/**
 * Contract for `GET /api/plugins`.
 *
 * Lists every agent plugin registered with the running `PluginRegistry`.
 * Shape matches the pre-migration route: an array of `{ name, metadata? }`
 * wrapped in `{ plugins }` for future-proofing (capability filters,
 * pagination, etc.).
 *
 * The registry itself is populated at process startup inside
 * `getPlatformServices()` — this endpoint is a read-only snapshot of what
 * the runtime can dispatch to. Metadata is optional because plugins
 * registered before the capability-metadata convention landed may still
 * omit it; callers that rely on it should tolerate `undefined`.
 */

export const PluginSummarySchema = z.object({
  name: z.string().min(1),
  metadata: PluginCapabilityMetadataSchema.optional(),
});

export const ListPluginsInputSchema = z.object({});

export const ListPluginsOutputSchema = z.object({
  plugins: z.array(PluginSummarySchema),
});

export type PluginSummary = z.infer<typeof PluginSummarySchema>;
export type ListPluginsInput = z.infer<typeof ListPluginsInputSchema>;
export type ListPluginsOutput = z.infer<typeof ListPluginsOutputSchema>;
