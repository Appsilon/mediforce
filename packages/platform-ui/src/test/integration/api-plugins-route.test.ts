import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { PluginCapabilityMetadata } from '@mediforce/platform-core';

vi.mock('../../lib/platform-services', () => {
  const mockPlugins = new Map<string, { metadata?: PluginCapabilityMetadata }>();
  return {
    getPlatformServices: () => ({
      pluginRegistry: {
        list: () =>
          Array.from(mockPlugins.entries()).map(([name, plugin]) => ({
            name,
            metadata: plugin.metadata,
          })),
      },
      namespaceRepo: {},
    }),
    _mockPlugins: mockPlugins,
  };
});

vi.mock('../../lib/api-auth', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api-auth')>(
    '../../lib/api-auth',
  );
  return {
    ...actual,
    resolveCallerIdentity: async () => ({ kind: 'apiKey' as const, isSystemActor: true as const }),
  };
});

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/plugins');
}

describe('GET /api/plugins', () => {
  let mockPlugins: Map<string, { metadata?: PluginCapabilityMetadata }>;

  beforeEach(async () => {
    const mod = await import('../../lib/platform-services');
    mockPlugins = (mod as unknown as { _mockPlugins: Map<string, { metadata?: PluginCapabilityMetadata }> })._mockPlugins;
    mockPlugins.clear();
  });

  it('[DATA] returns 200 with plugins array', async () => {
    const { GET } = await import('../../app/api/plugins/route');
    const response = await GET(makeRequest(), undefined);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('plugins');
    expect(Array.isArray(body.plugins)).toBe(true);
  });

  it('[DATA] returns plugins with name and metadata fields', async () => {
    const testMetadata: PluginCapabilityMetadata = {
      name: 'Compliance Analyzer',
      description: 'Analyzes compliance data',
      inputDescription: 'Vendor performance records',
      outputDescription: 'Compliance assessment',
      roles: ['executor'],
    };
    mockPlugins.set('sc/compliance-analyzer', { metadata: testMetadata });

    const { GET } = await import('../../app/api/plugins/route');
    const response = await GET(makeRequest(), undefined);
    const body = await response.json();

    expect(body.plugins).toHaveLength(1);
    expect(body.plugins[0].name).toBe('sc/compliance-analyzer');
    expect(body.plugins[0].metadata).toEqual(testMetadata);
    expect(body.plugins[0].metadata.roles).toEqual(['executor']);
  });

  it('[DATA] returns plugin without metadata as undefined', async () => {
    mockPlugins.set('basic-plugin', {});

    const { GET } = await import('../../app/api/plugins/route');
    const response = await GET(makeRequest(), undefined);
    const body = await response.json();

    expect(body.plugins).toHaveLength(1);
    expect(body.plugins[0].name).toBe('basic-plugin');
    expect(body.plugins[0].metadata).toBeUndefined();
  });
});
