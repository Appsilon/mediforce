import { describe, expect, it } from 'vitest';
import type { PluginCapabilityMetadata } from '@mediforce/platform-core';
import { listPlugins, type PluginRegistryView } from '../list-plugins.js';
import type { CallerIdentity } from '../../../auth.js';

/**
 * Handler is pure: it forwards whatever the registry's `list()` returns,
 * mapping each entry into the contract envelope. Tests use a hand-rolled
 * stub registry — the handler doesn't depend on `agent-runtime`'s real
 * `PluginRegistry`, only on its structural shape.
 */

const apiKey: CallerIdentity = { kind: 'apiKey' };

function stubRegistry(
  entries: ReadonlyArray<{ name: string; metadata?: PluginCapabilityMetadata }>,
): PluginRegistryView {
  return { list: () => entries };
}

describe('listPlugins handler', () => {
  it('returns the registered plugins in registry order', async () => {
    const metadata: PluginCapabilityMetadata = {
      name: 'gather-data',
      description: 'Collects upstream data for a step.',
      inputDescription: 'Task context with target sources.',
      outputDescription: 'Structured dataset for downstream steps.',
      roles: ['executor'],
    };
    const registry = stubRegistry([
      { name: 'gather-data', metadata },
      { name: 'legacy-plugin' },
    ]);

    const result = await listPlugins({}, { pluginRegistry: registry }, apiKey);

    expect(result).toEqual({
      plugins: [
        { name: 'gather-data', metadata },
        { name: 'legacy-plugin', metadata: undefined },
      ],
    });
  });

  it('returns an empty list when no plugins are registered', async () => {
    const result = await listPlugins(
      {},
      { pluginRegistry: stubRegistry([]) },
      apiKey,
    );
    expect(result).toEqual({ plugins: [] });
  });
});
