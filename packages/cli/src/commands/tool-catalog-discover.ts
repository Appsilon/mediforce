import { defineCommand } from '../define-command';
import { printError, printJson } from '../output';

export const toolCatalogDiscoverCommand = defineCommand({
  name: 'mediforce tool-catalog discover',
  description:
    'List the tools an MCP server exposes: a Tool Catalog entry (--catalog-id) or an unauthenticated HTTP server (--url). Admin only.',
  args: {
    namespace: { type: 'string', required: true, description: 'Workspace handle' },
    'catalog-id': { type: 'string', description: 'Tool Catalog entry id (stdio server)' },
    url: { type: 'string', description: 'URL of an unauthenticated HTTP MCP server' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const catalogId = args['catalog-id'];
    if ((catalogId === undefined) === (args.url === undefined)) {
      printError(output, { error: 'pass exactly one of --catalog-id or --url' }, jsonMode);
      return 1;
    }
    const result = await mediforce.toolCatalog.discoverTools(
      catalogId !== undefined
        ? { namespace: args.namespace, type: 'stdio', catalogId }
        : { namespace: args.namespace, type: 'http', url: args.url as string },
    );
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
