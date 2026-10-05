import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryToolCatalogRepository } from '@mediforce/platform-core/testing';
import { discoverMcpTools } from '../discover-tools';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../errors';
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

  it('lists the tools of a catalog entry with the probe prefix stripped', async () => {
    const scope = createTestScope({ toolCatalogRepo: repo });

    const result = await discoverMcpTools(
      { namespace: 'alpha', type: 'stdio', catalogId: sampleEntry.id },
      scope,
    );

    expect(result.tools).toEqual([
      { name: 'query', description: 'Run a query' },
      { name: 'list_tables' },
    ]);
    expect(mcpClient.constructed).toHaveBeenCalledWith([
      expect.objectContaining({ command: sampleEntry.command }),
    ]);
    expect(mcpClient.disconnect).toHaveBeenCalledOnce();
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

  it('throws NotFoundError for an unknown catalog entry', async () => {
    const scope = createTestScope({ toolCatalogRepo: repo });

    await expect(
      discoverMcpTools({ namespace: 'alpha', type: 'stdio', catalogId: 'missing' }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('maps connection failures to ValidationError and still disconnects', async () => {
    mcpClient.connect.mockRejectedValue(new Error('spawn ENOENT'));
    const scope = createTestScope({ toolCatalogRepo: repo });

    await expect(
      discoverMcpTools({ namespace: 'alpha', type: 'stdio', catalogId: sampleEntry.id }, scope),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mcpClient.disconnect).toHaveBeenCalledOnce();
  });

  it('rejects a non-admin member', async () => {
    const scope = createTestScope({
      toolCatalogRepo: repo,
      caller: userCaller('u-member', ['alpha'], memberRoles),
    });

    await expect(
      discoverMcpTools({ namespace: 'alpha', type: 'stdio', catalogId: sampleEntry.id }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
