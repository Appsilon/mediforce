import { z } from 'zod';

export const McpServerConfigSchema = z.object({
  /** Unique name for this MCP server (used as key in config file and UI display) */
  name: z.string().min(1),
  /** Command to start the MCP server via stdio transport (e.g., "npx", "python", "node").
   *  Either command (stdio) or url (HTTP) must be provided. */
  command: z.string().min(1).optional(),
  /** Arguments to the command */
  args: z.array(z.string()).default([]),
  /** Environment variables for the MCP server process.
   *  Supports {{SECRET}} template syntax for secret resolution. */
  env: z.record(z.string(), z.string()).optional(),
  /** URL for HTTP transport (Streamable HTTP).
   *  Either command (stdio) or url (HTTP) must be provided. */
  url: z.string().url().optional(),
  /** Human-readable description (for UI and audit trail) */
  description: z.string().optional(),
  /** Allowlist of specific tool names exposed by this server.
   *  When set, only these tools are available to the agent.
   *  When omitted, all tools from the server are available. */
  allowedTools: z.array(z.string()).optional(),
}).refine(
  data => data.command !== undefined || data.url !== undefined,
  { message: 'Either command (stdio) or url (HTTP) must be provided' },
);

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
