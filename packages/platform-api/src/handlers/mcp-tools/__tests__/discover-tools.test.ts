import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryToolCatalogRepository } from '@mediforce/platform-core/testing';
import { discoverMcpTools } from '../discover-tools';
import { ForbiddenError, ValidationError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import { memberRoles, sampleEntry } from '../../tool-catalog/__tests__/fixtures';

const mcpClient = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  constructed: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

vi.mock('@mediforce/mcp-client', () => ({
  McpClientManager: class {
    constructor(servers: unknown) {
      mcpClient.constructed(servers);
    }
    connect = mcpClient.connect;
    disconnect = mcpClient.disconnect;
  },
}));

describe('discoverMcpTools handler', () => {
  let repo: InMemoryToolCatalogRepository;

  beforeEach(async () => {
    vi.clearAllMocks();
    repo = new InMemoryToolCatalogRepository();
    await repo.upsert('alpha', sampleEntry);
    mcpClient.connect.mockResolvedValue([
      { type: 'function', function: { name: 'probe__query', description: 'Run a query', parameters: {} } },
      { type: 'function', function: { name: 'probe__list_tables', description: '', parameters: {} } },
    ]);
  });

  it('probes an HTTP server by url', async () => {
    const scope = createTestScope({ toolCatalogRepo: repo });

    await discoverMcpTools(
      { namespace: 'alpha', type: 'http', url: 'https://mcp.example.com/mcp' },
      scope,
    );

    expect(mcpClient.constructed).toHaveBeenCalledWith([
      expect.objectContaining({ url: 'https://mcp.example.com/mcp' }),
    ]);
  });

  it.each([
    'http://127.0.0.1:8080/mcp',
    'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.5/mcp',
    'http://192.168.1.10/mcp',
    'http://[::1]/mcp',
  ])('rejects the private HTTP target %s without connecting', async (url) => {
    const scope = createTestScope({ toolCatalogRepo: repo });

    await expect(
      discoverMcpTools({ namespace: 'alpha', type: 'http', url }, scope),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mcpClient.constructed).not.toHaveBeenCalled();
  });

  it('maps connection failures to ValidationError and still disconnects', async () => {
    mcpClient.connect.mockRejectedValue(new Error('spawn ENOENT'));
    const scope = createTestScope({ toolCatalogRepo: repo });

    await expect(
      discoverMcpTools({ namespace: 'alpha', type: 'http', url: 'https://mcp.example.com/mcp' }, scope),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mcpClient.disconnect).toHaveBeenCalledOnce();
  });

  it('rejects a non-admin member', async () => {
    const scope = createTestScope({
      toolCatalogRepo: repo,
      caller: userCaller('u-member', ['alpha'], memberRoles),
    });

    await expect(
      discoverMcpTools({ namespace: 'alpha', type: 'http', url: 'https://mcp.example.com/mcp' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
