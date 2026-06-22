import { describe, expect, it } from 'vitest';
import type { PluginCapabilityMetadata } from '@mediforce/platform-core';
import { listPlugins } from '../list-plugins';
import { createTestScope } from '../../../repositories/__tests__/create-test-scope';

/**
 * Handler is pure: it forwards whatever the registry's `list()` returns,
 * mapping each entry into the contract envelope. Tests use a hand-rolled
 * stub registry — the handler doesn't depend on `agent-runtime`'s real
 * `PluginRegistry`, only on its structural shape.
 */

function stubRegistry(entries: ReadonlyArray<{ name: string; metadata?: PluginCapabilityMetadata }>): {
  list: () => ReadonlyArray<{ name: string; metadata?: PluginCapabilityMetadata }>;
} {
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
    const registry = stubRegistry([{ name: 'gather-data', metadata }, { name: 'legacy-plugin' }]);

    const scope = createTestScope({ pluginRegistry: registry });
    const result = await listPlugins({}, scope);

    expect(result).toEqual({
      plugins: [
        { name: 'gather-data', metadata },
        { name: 'legacy-plugin', metadata: undefined },
      ],
    });
  });

  it('returns an empty list when no plugins are registered', async () => {
    const scope = createTestScope({ pluginRegistry: stubRegistry([]) });
    const result = await listPlugins({}, scope);
    expect(result).toEqual({ plugins: [] });
  });
});
