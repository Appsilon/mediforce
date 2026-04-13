import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerConfig } from '@mediforce/platform-core';
import type { McpToolDefinition, McpToolCallResult, McpClientManagerOptions } from './types.js';
import { resolveValue } from './resolve-env.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const NAMESPACE_SEPARATOR = '__';

interface ConnectedServer {
  name: string;
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
  tools: Map<string, { originalName: string }>;
}

/**
 * Manages connections to one or more MCP servers.
 * Handles transport lifecycle, tool discovery, namespacing, and tool execution.
 */
export class McpClientManager {
  private readonly servers: McpServerConfig[];
  private readonly options: McpClientManagerOptions;
  private readonly connected: Map<string, ConnectedServer> = new Map();

  constructor(servers: McpServerConfig[], options?: McpClientManagerOptions) {
    this.servers = servers;
    this.options = options ?? {};
  }

  /**
   * Connect to all configured MCP servers and discover their tools.
   * Returns all tools in OpenRouter-compatible function format, namespaced as serverName__toolName.
   */
  async connect(): Promise<McpToolDefinition[]> {
    const allTools: McpToolDefinition[] = [];

    for (const serverConfig of this.servers) {
      const resolvedEnv: Record<string, string> = {};
      if (serverConfig.env) {
        for (const [key, value] of Object.entries(serverConfig.env)) {
          resolvedEnv[key] = resolveValue(value, this.options.workflowSecrets);
        }
      }

      let transport: StdioClientTransport | StreamableHTTPClientTransport;

      if (serverConfig.command) {
        transport = new StdioClientTransport({
          command: serverConfig.command,
          args: serverConfig.args ?? [],
          env: {
            ...process.env as Record<string, string>,
            ...resolvedEnv,
          },
        });
      } else if (serverConfig.url) {
        transport = new StreamableHTTPClientTransport(
          new URL(serverConfig.url),
        );
      } else {
        throw new Error(`MCP server '${serverConfig.name}': either command or url must be provided`);
      }

      const client = new Client({
        name: `mediforce-cowork-${serverConfig.name}`,
        version: '1.0.0',
      });

      await client.connect(transport);

      const toolsResponse = await client.listTools();
      const toolMap = new Map<string, { originalName: string }>();

      for (const tool of toolsResponse.tools) {
        // Apply allowedTools filter
        if (serverConfig.allowedTools && serverConfig.allowedTools.length > 0) {
          if (!serverConfig.allowedTools.includes(tool.name)) continue;
        }

        const namespacedName = `${serverConfig.name}${NAMESPACE_SEPARATOR}${tool.name}`;
        toolMap.set(namespacedName, { originalName: tool.name });

        allTools.push({
          type: 'function',
          function: {
            name: namespacedName,
            description: tool.description ?? '',
            parameters: (tool.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
          },
        });
      }

      this.connected.set(serverConfig.name, {
        name: serverConfig.name,
        client,
        transport,
        tools: toolMap,
      });
    }

    return allTools;
  }

  /**
   * Call a tool by its namespaced name (serverName__toolName).
   * Returns the result content and error status.
   */
  async callTool(namespacedName: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    const separatorIndex = namespacedName.indexOf(NAMESPACE_SEPARATOR);
    if (separatorIndex === -1) {
      throw new Error(`Invalid namespaced tool name '${namespacedName}': expected format 'serverName__toolName'`);
    }

    const serverName = namespacedName.slice(0, separatorIndex);
    const server = this.connected.get(serverName);
    if (!server) {
      throw new Error(`MCP server '${serverName}' not connected`);
    }

    const toolInfo = server.tools.get(namespacedName);
    if (!toolInfo) {
      throw new Error(`Tool '${namespacedName}' not found on server '${serverName}'`);
    }

    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const result = await server.client.callTool(
        { name: toolInfo.originalName, arguments: args },
        undefined,
        { signal: abortController.signal },
      );

      const contentParts = result.content as Array<{ type: string; text?: string }>;
      const textContent = contentParts
        .filter((part) => part.type === 'text' && part.text !== undefined)
        .map((part) => part.text)
        .join('\n');

      return {
        content: textContent || JSON.stringify(result.content),
        isError: result.isError === true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: `Tool execution failed: ${message}`,
        isError: true,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Disconnect from all MCP servers and clean up transports.
   */
  async disconnect(): Promise<void> {
    for (const server of this.connected.values()) {
      try {
        await server.client.close();
      } catch {
        // Ignore cleanup errors
      }
    }
    this.connected.clear();
  }
}
