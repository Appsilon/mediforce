import { createRouteAdapter } from '@/lib/route-adapter';
import { listPlugins } from '@mediforce/platform-api/handlers';
import { ListPluginsInputSchema } from '@mediforce/platform-api/contract';

/**
 * GET /api/plugins
 *
 * Returns `{ plugins: PluginSummary[] }`. The registry is platform-wide and
 * not workspace-scoped; the handler is `@public-handler` — every authenticated
 * caller sees the same list.
 */
export const GET = createRouteAdapter(ListPluginsInputSchema, () => ({}), listPlugins);
