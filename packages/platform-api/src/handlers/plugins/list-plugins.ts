import type { PluginCapabilityMetadata } from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index.js';
import type { ListPluginsInput, ListPluginsOutput } from '../../contract/plugins.js';

/**
 * List every plugin registered with the running `PluginRegistry`.
 *
 * @public-handler  Registry is platform-wide, not workspace-scoped — every
 * authenticated caller sees the same list.
 *
 * The wrapper layer doesn't gate this (`scope.plugins` is a pass-through);
 * the no-raw-repo-imports static guard passes because the handler only
 * touches `scope`.
 */
export async function listPlugins(
  _input: ListPluginsInput,
  scope: CallerScope,
): Promise<ListPluginsOutput> {
  const plugins = scope.plugins.list().map((entry) => ({
    name: entry.name,
    metadata: entry.metadata as PluginCapabilityMetadata | undefined,
  }));
  return { plugins };
}
