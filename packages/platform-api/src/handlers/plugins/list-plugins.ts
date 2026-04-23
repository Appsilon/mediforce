import type { PluginCapabilityMetadata } from '@mediforce/platform-core';
import type {
  ListPluginsInput,
  ListPluginsOutput,
} from '../../contract/plugins.js';

/**
 * Narrow view of the plugin registry — just what the handler needs to
 * produce the list response.
 *
 * `PluginRegistry.list()` is **synchronous** (it inspects an in-process
 * Map), so the dep is typed as a sync function to keep the handler honest
 * about what it's calling. Tests can supply a plain `{ list: () => [...] }`
 * object; production wires in the real `PluginRegistry` from
 * `@mediforce/agent-runtime`.
 */
export interface PluginRegistryView {
  list(): Array<{ name: string; metadata?: PluginCapabilityMetadata }>;
}

export interface ListPluginsDeps {
  pluginRegistry: PluginRegistryView;
}

export async function listPlugins(
  _input: ListPluginsInput,
  deps: ListPluginsDeps,
): Promise<ListPluginsOutput> {
  const plugins = deps.pluginRegistry.list();
  return { plugins };
}
