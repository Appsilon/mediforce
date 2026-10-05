import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const toolCatalogDiscoverCommand = defineCommand({
  name: 'mediforce tool-catalog discover',
  description:
    'List the tools an unauthenticated, publicly reachable HTTP MCP server exposes. Admin only.',
  args: {
    namespace: { type: 'string', required: true, description: 'Workspace handle' },
    url: { type: 'string', required: true, description: 'URL of an unauthenticated HTTP MCP server' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.toolCatalog.discoverTools({
      namespace: args.namespace,
      type: 'http',
      url: args.url,
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Found ${String(result.tools.length)} tool(s):`);
    for (const tool of result.tools) {
      output.stdout(`  ${tool.name}${tool.description === undefined ? '' : `  — ${tool.description}`}`);
    }
    return 0;
  },
});
