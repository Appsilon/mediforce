#!/usr/bin/env tsx
/**
 * Minimal MCP stdio server used by Tier 2 integration tests. Exposes a
 * single `echo(msg: string)` tool so tests can verify the full roundtrip
 * (MediForce resolver → McpClientManager → LLM tool_call → tool result →
 * LLM final response) without depending on any real third-party MCP.
 *
 * Not a test fixture in the sense of "data" — this is a real MCP server,
 * just shaped to be deterministic enough for assertions.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'echo-mcp',
  version: '0.1.0',
});

server.registerTool(
  'echo',
  {
    description:
      'Echo back the provided message. Used by MediForce MCP integration tests to verify the stdio transport roundtrip.',
    inputSchema: { msg: z.string() },
  },
  async ({ msg }) => ({
    content: [{ type: 'text', text: `Echoed: ${msg}` }],
  }),
);

void (async () => {
  await server.connect(new StdioServerTransport());
})();
