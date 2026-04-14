import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerConfig } from '@mediforce/platform-core';
import type { McpToolDefinition, McpToolCallResult, McpClientManagerOptions } from './types.js';
import { resolveValue } from './resolve-env.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const NAMESPACE_SEPARATOR = '__';

/**
 * Env vars inherited by stdio MCP subprocesses. Deliberately narrow to avoid
 * leaking platform secrets (Firebase, OpenRouter, DB creds, etc.) to third-party
 * MCP servers. Add keys here only if they are operationally required and non-sensitive.
 * Any secret the server needs must be passed explicitly via McpServerConfig.env.
 */
const INHERITED_ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TMPDIR',
  'TEMP',
  'TMP',
  'NODE_ENV',
  'NODE_PATH',
] as const;

function inheritedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of INHERITED_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

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
   * Servers are connected in parallel so total latency is max(server), not sum(server).
   * If any server fails to connect, already-connected transports are torn down and the error bubbles up.
   * Returns all tools in OpenRouter-compatible function format, namespaced as serverName__toolName.
   */
  async connect(): Promise<McpToolDefinition[]> {
    const results = await Promise.allSettled(
      this.servers.map((serverConfig) => this.connectServer(serverConfig)),
    );

    const rejected = results
      .map((r, i) => ({ r, name: this.servers[i].name }))
      .filter((x): x is { r: PromiseRejectedResult; name: string } => x.r.status === 'rejected');

    if (rejected.length > 0) {
      // Roll back any already-connected servers so the manager is not left in a partial state.
      await this.disconnect();
      const firstError = rejected[0].r.reason;
      const message = firstError instanceof Error ? firstError.message : String(firstError);
      throw new Error(`Failed to connect MCP server '${rejected[0].name}': ${message}`);
    }

    const allTools: McpToolDefinition[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') allTools.push(...r.value);
    }
    return allTools;
  }

  private async connectServer(serverConfig: McpServerConfig): Promise<McpToolDefinition[]> {
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
          ...inheritedEnv(),
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
    const serverTools: McpToolDefinition[] = [];

    for (const tool of toolsResponse.tools) {
      if (serverConfig.allowedTools && serverConfig.allowedTools.length > 0) {
        if (!serverConfig.allowedTools.includes(tool.name)) continue;
      }

      const namespacedName = `${serverConfig.name}${NAMESPACE_SEPARATOR}${tool.name}`;
      toolMap.set(namespacedName, { originalName: tool.name });

      serverTools.push({
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

    return serverTools;
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
