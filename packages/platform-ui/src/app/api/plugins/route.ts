import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter } from '@/lib/route-adapter';
import { listPlugins } from '@mediforce/platform-api/handlers';
import { ListPluginsInputSchema } from '@mediforce/platform-api/contract';

/**
 * GET /api/plugins
 *
 * Returns `{ plugins: PluginSummary[] }` — every agent plugin registered
 * with the running `PluginRegistry` at startup. The registry's `list()` is
 * synchronous; the handler simply wraps it in the contract envelope.
 */
export const GET = createRouteAdapter(
  ListPluginsInputSchema,
  () => ({}),
  (input) =>
    listPlugins(input, { pluginRegistry: getPlatformServices().pluginRegistry }),
);
