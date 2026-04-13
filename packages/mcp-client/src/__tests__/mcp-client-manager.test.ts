import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServerConfig } from '@mediforce/platform-core';

// Mock the MCP SDK modules
const mockConnect = vi.fn();
const mockClose = vi.fn();
const mockListTools = vi.fn();
const mockCallTool = vi.fn();

// Track constructor args for assertions
const stdioConstructorCalls: Array<Record<string, unknown>> = [];
const httpConstructorCalls: Array<URL> = [];

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  return {
    Client: class MockClient {
      connect = mockConnect;
      close = mockClose;
      listTools = mockListTools;
      callTool = mockCallTool;
    },
  };
});

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => {
  return {
    StdioClientTransport: class MockStdioTransport {
      constructor(opts: Record<string, unknown>) {
        stdioConstructorCalls.push(opts);
      }
    },
  };
});

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => {
  return {
    StreamableHTTPClientTransport: class MockHttpTransport {
      constructor(url: URL) {
        httpConstructorCalls.push(url);
      }
    },
  };
});

// Import after mocks
const { McpClientManager } = await import('../mcp-client-manager.js');

const TEALFLOW_TOOLS = [
  {
    name: 'tealflow_list_modules',
    description: 'List all available teal modules',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'tealflow_get_module',
    description: 'Get details about a specific teal module',
    inputSchema: {
      type: 'object',
      properties: { module_name: { type: 'string' } },
      required: ['module_name'],
    },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  stdioConstructorCalls.length = 0;
  httpConstructorCalls.length = 0;
  mockListTools.mockResolvedValue({ tools: TEALFLOW_TOOLS });
  mockCallTool.mockResolvedValue({
    content: [{ type: 'text', text: '["tm_ae_table", "tm_demographics"]' }],
    isError: false,
  });
});

describe('McpClientManager', () => {
  const stdioServer: McpServerConfig = {
    name: 'tealflow',
    command: 'tealflow-mcp',
    args: [],
  };

  describe('connect()', () => {
    it('should discover and namespace tools from a stdio server', async () => {
      const manager = new McpClientManager([stdioServer]);
      const tools = await manager.connect();

      expect(tools).toHaveLength(2);
      expect(tools[0].type).toBe('function');
      expect(tools[0].function.name).toBe('tealflow__tealflow_list_modules');
      expect(tools[0].function.description).toBe('List all available teal modules');
      expect(tools[1].function.name).toBe('tealflow__tealflow_get_module');

      expect(stdioConstructorCalls).toHaveLength(1);
      expect(stdioConstructorCalls[0]).toMatchObject({
        command: 'tealflow-mcp',
        args: [],
      });
    });

    it('should create HTTP transport when url is provided', async () => {
      const httpServer: McpServerConfig = {
        name: 'remote',
        url: 'https://mcp.example.com/v1',
        args: [],
      };

      const manager = new McpClientManager([httpServer]);
      await manager.connect();

      expect(httpConstructorCalls).toHaveLength(1);
      expect(httpConstructorCalls[0].toString()).toBe('https://mcp.example.com/v1');
    });

    it('should apply allowedTools filter', async () => {
      const filteredServer: McpServerConfig = {
        name: 'tealflow',
        command: 'tealflow-mcp',
        args: [],
        allowedTools: ['tealflow_list_modules'],
      };

      const manager = new McpClientManager([filteredServer]);
      const tools = await manager.connect();

      expect(tools).toHaveLength(1);
      expect(tools[0].function.name).toBe('tealflow__tealflow_list_modules');
    });

    it('should connect to multiple servers and namespace tools per server', async () => {
      const secondServer: McpServerConfig = {
        name: 'filesystem',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
      };

      const fsTools = [
        { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object', properties: {} } },
      ];

      // First call returns tealflow tools, second returns filesystem tools
      mockListTools
        .mockResolvedValueOnce({ tools: TEALFLOW_TOOLS })
        .mockResolvedValueOnce({ tools: fsTools });

      const manager = new McpClientManager([stdioServer, secondServer]);
      const tools = await manager.connect();

      expect(tools).toHaveLength(3);
      expect(tools[0].function.name).toBe('tealflow__tealflow_list_modules');
      expect(tools[1].function.name).toBe('tealflow__tealflow_get_module');
      expect(tools[2].function.name).toBe('filesystem__read_file');
    });

    it('should resolve env templates via resolveValue', async () => {
      const serverWithEnv: McpServerConfig = {
        name: 'api-server',
        command: 'node',
        args: ['server.js'],
        env: { API_KEY: 'literal-key', DB_URL: '{{DB_CONNECTION}}' },
      };

      // Set the env var so resolveValue works
      process.env['DB_CONNECTION'] = 'postgres://localhost/test';

      const manager = new McpClientManager([serverWithEnv]);
      await manager.connect();

      expect(stdioConstructorCalls).toHaveLength(1);
      expect(stdioConstructorCalls[0]).toMatchObject({
        env: expect.objectContaining({
          API_KEY: 'literal-key',
          DB_URL: 'postgres://localhost/test',
        }),
      });

      delete process.env['DB_CONNECTION'];
    });

    it('should throw if neither command nor url is provided', async () => {
      // We use "as" here because the schema refinement would normally prevent this,
      // but the manager should still guard against it at runtime
      const invalidServer = { name: 'broken', args: [] } as McpServerConfig;
      const manager = new McpClientManager([invalidServer]);

      await expect(manager.connect()).rejects.toThrow('either command or url must be provided');
    });
  });

  describe('callTool()', () => {
    it('should dispatch to the correct server and return result', async () => {
      const manager = new McpClientManager([stdioServer]);
      await manager.connect();

      const result = await manager.callTool('tealflow__tealflow_list_modules', {});

      expect(result.content).toBe('["tm_ae_table", "tm_demographics"]');
      expect(result.isError).toBe(false);
      expect(mockCallTool).toHaveBeenCalledWith(
        { name: 'tealflow_list_modules', arguments: {} },
        undefined,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('should return error result on tool execution failure', async () => {
      mockCallTool.mockRejectedValueOnce(new Error('Server crashed'));

      const manager = new McpClientManager([stdioServer]);
      await manager.connect();

      const result = await manager.callTool('tealflow__tealflow_list_modules', {});

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Server crashed');
    });

    it('should return error status from MCP protocol', async () => {
      mockCallTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Tool not available' }],
        isError: true,
      });

      const manager = new McpClientManager([stdioServer]);
      await manager.connect();

      const result = await manager.callTool('tealflow__tealflow_list_modules', {});

      expect(result.isError).toBe(true);
      expect(result.content).toBe('Tool not available');
    });

    it('should throw for invalid namespaced tool name format', async () => {
      const manager = new McpClientManager([stdioServer]);
      await manager.connect();

      await expect(manager.callTool('invalidname', {})).rejects.toThrow(
        "Invalid namespaced tool name 'invalidname'",
      );
    });

    it('should throw for unknown server', async () => {
      const manager = new McpClientManager([stdioServer]);
      await manager.connect();

      await expect(manager.callTool('unknown__tool', {})).rejects.toThrow(
        "MCP server 'unknown' not connected",
      );
    });

    it('should throw for unknown tool on known server', async () => {
      const manager = new McpClientManager([stdioServer]);
      await manager.connect();

      await expect(manager.callTool('tealflow__nonexistent_tool', {})).rejects.toThrow(
        "Tool 'tealflow__nonexistent_tool' not found",
      );
    });
  });

  describe('disconnect()', () => {
    it('should close all connected clients', async () => {
      const manager = new McpClientManager([stdioServer]);
      await manager.connect();
      await manager.disconnect();

      expect(mockClose).toHaveBeenCalledOnce();
    });

    it('should not throw if a client close fails', async () => {
      mockClose.mockRejectedValueOnce(new Error('close failed'));

      const manager = new McpClientManager([stdioServer]);
      await manager.connect();

      await expect(manager.disconnect()).resolves.toBeUndefined();
    });

    it('should handle disconnect when not connected', async () => {
      const manager = new McpClientManager([stdioServer]);
      await expect(manager.disconnect()).resolves.toBeUndefined();
    });
  });
});
