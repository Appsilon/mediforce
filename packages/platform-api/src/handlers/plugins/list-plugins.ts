import type { PluginCapabilityMetadata } from '@mediforce/platform-core';
import type { CallerIdentity } from '../../auth.js';
import type { ListPluginsInput, ListPluginsOutput } from '../../contract/plugins.js';

/**
 * Minimal view of the agent-runtime `PluginRegistry` the handler depends on.
 *
 * Declared structurally so tests can pass a plain `{ list: () => [...] }`
 * stub without depending on `@mediforce/agent-runtime`. The real registry
 * (`agent-runtime`'s `PluginRegistry`) satisfies this shape by construction.
 */
export interface PluginRegistryView {
  list(): ReadonlyArray<{ name: string; metadata?: PluginCapabilityMetadata }>;
}

export interface ListPluginsDeps {
  pluginRegistry: PluginRegistryView;
}

/**
 * List every plugin registered with the running `PluginRegistry`.
 *
 * @public-handler  Registry is platform-wide, not namespaced — every
 * authenticated caller sees the same list.
 *
 * The registry is a process-wide singleton populated at startup — it is not
 * namespaced and has no per-tenant view. Every authenticated caller sees the
 * same list, so the third `caller` argument is intentionally unused. It is
 * still part of the signature because the route adapter threads a
 * `CallerIdentity` into every handler uniformly; deviating here would force
 * a one-off adapter shape for this endpoint.
 */
export async function listPlugins(
  _input: ListPluginsInput,
  deps: ListPluginsDeps,
  _caller: CallerIdentity,
): Promise<ListPluginsOutput> {
  const plugins = deps.pluginRegistry.list().map((entry) => ({
    name: entry.name,
    metadata: entry.metadata,
  }));
  return { plugins };
}
