/**
 * OpenRouter / OpenAI compatible function tool definition.
 * Produced by McpClientManager.connect() from MCP tool schemas.
 */
export interface McpToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Result of calling an MCP tool.
 */
export interface McpToolCallResult {
  content: string;
  isError: boolean;
}

/**
 * Options for McpClientManager.
 */
export interface McpClientManagerOptions {
  /** Per-tool-call timeout in milliseconds (default: 30_000) */
  timeoutMs?: number;
  /** Workflow secrets for resolving {{SECRET}} templates in server env vars */
  workflowSecrets?: Record<string, string>;
}
