#!/usr/bin/env tsx
/**
 * Platform MCP server — exposes Mediforce platform utilities as MCP tools.
 *
 * Currently provides:
 *   render_workflow_diagram — takes a WorkflowDefinition-like object and
 *     returns an HTML diagram matching the platform's visual language.
 *
 * Runs via stdio transport. Register in the tool catalog as "platform-mcp"
 * so cowork agents and agent steps can call platform tools natively.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  renderWorkflowDiagram,
  RenderWorkflowDiagramInputSchema,
} from '@mediforce/platform-api/handlers';

const server = new McpServer({
  name: 'platform-mcp',
  version: '0.1.0',
});

const defSchema = RenderWorkflowDiagramInputSchema.shape.definition;

server.registerTool(
  'render_workflow_diagram',
  {
    description:
      'Render a WorkflowDefinition as an HTML diagram. Pass the full definition object ' +
      '(with steps, transitions, triggers). Returns HTML that can be used with update_presentation.',
    inputSchema: { definition: defSchema },
  },
  async ({ definition }) => {
    const html = renderWorkflowDiagram({ definition: definition as any });
    return {
      content: [{ type: 'text', text: html }],
    };
  },
);

void (async () => {
  await server.connect(new StdioServerTransport());
})();
