import { describe, it, expect, beforeEach } from 'vitest';
import { PluginRegistry } from './plugin-registry';
import type { StepExecutorPlugin, AgentContext, EmitFn } from '../interfaces/step-executor-plugin';
import type { PluginCapabilityMetadata } from '@mediforce/platform-core';

// Minimal mock plugin without metadata
function makeMockPlugin(): StepExecutorPlugin {
  return {
    initialize: async (_ctx: AgentContext) => {},
    run: async (_emit: EmitFn) => {},
  };
}

// Mock plugin with metadata
function makeMockPluginWithMetadata(metadata: PluginCapabilityMetadata): StepExecutorPlugin & { metadata: PluginCapabilityMetadata } {
  return {
    initialize: async (_ctx: AgentContext) => {},
    run: async (_emit: EmitFn) => {},
    metadata,
  };
}

const testMetadata: PluginCapabilityMetadata = {
  name: 'Data Analyzer',
  description: 'Analyzes data for quality review',
  inputDescription: 'Input records',
  outputDescription: 'Assessment report',
  roles: ['executor'],
};

describe('PluginRegistry.list()', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  it('[DATA] returns empty array when no plugins registered', () => {
    expect(registry.list()).toEqual([]);
  });

  it('[DATA] returns {name, metadata} for plugin with metadata', () => {
    const plugin = makeMockPluginWithMetadata(testMetadata);
    registry.register('data-analyzer', plugin);

    const result = registry.list();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'data-analyzer',
      metadata: testMetadata,
    });
  });

  it('[DATA] returns {name, metadata: undefined} for plugin without metadata', () => {
    const plugin = makeMockPlugin();
    registry.register('basic-plugin', plugin);

    const result = registry.list();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'basic-plugin',
      metadata: undefined,
    });
  });

  it('[DATA] returns all registered plugins', () => {
    registry.register('plugin-a', makeMockPlugin());
    registry.register('plugin-b', makeMockPluginWithMetadata(testMetadata));

    const result = registry.list();
    expect(result).toHaveLength(2);

    const names = result.map((p) => p.name);
    expect(names).toContain('plugin-a');
    expect(names).toContain('plugin-b');
  });
});
