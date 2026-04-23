import { describe, expect, it } from 'vitest';
import type { PluginCapabilityMetadata } from '@mediforce/platform-core';
import { listPlugins } from '../list-plugins.js';
import type { PluginRegistryView } from '../list-plugins.js';

function buildRegistry(
  plugins: Array<{ name: string; metadata?: PluginCapabilityMetadata }>,
): PluginRegistryView {
  return {
    list: () => plugins,
  };
}

const sampleMetadata: PluginCapabilityMetadata = {
  name: 'claude-code-agent',
  description: 'Runs Claude Code against a workspace',
  inputDescription: 'Repository path + task prompt',
  outputDescription: 'Artifact diff + audit log',
  roles: ['executor'],
};

describe('listPlugins handler', () => {
  it('returns every plugin the registry reports', async () => {
    const pluginRegistry = buildRegistry([
      { name: 'claude-code-agent', metadata: sampleMetadata },
      { name: 'opencode-agent' },
      { name: 'script-container' },
    ]);

    const result = await listPlugins({}, { pluginRegistry });

    expect(result.plugins).toHaveLength(3);
    expect(result.plugins.map((p) => p.name)).toEqual([
      'claude-code-agent',
      'opencode-agent',
      'script-container',
    ]);
  });

  it('preserves metadata when the registry reports it', async () => {
    const pluginRegistry = buildRegistry([
      { name: 'claude-code-agent', metadata: sampleMetadata },
    ]);

    const result = await listPlugins({}, { pluginRegistry });

    expect(result.plugins[0].metadata).toEqual(sampleMetadata);
  });

  it('returns an empty array when no plugins are registered', async () => {
    const pluginRegistry = buildRegistry([]);

    const result = await listPlugins({}, { pluginRegistry });

    expect(result.plugins).toEqual([]);
  });
});
