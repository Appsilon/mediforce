import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const toolCatalogListCommand = defineCommand({
  name: 'mediforce tool-catalog list',
  description: 'List the MCP servers an agent in this workspace can bind to.',
  args: {
    namespace: { type: 'string', required: true, description: 'Workspace handle' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.toolCatalog.list({ namespace: args.namespace });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.entries.length === 0) {
      output.stdout(`No Tool Catalog entries in '${args.namespace}'.`);
      return 0;
    }
    output.stdout(`Found ${String(result.entries.length)} entr(ies):`);
    for (const entry of result.entries) {
      const command = [entry.command, ...(entry.args ?? [])].join(' ');
      output.stdout(`  ${entry.id}  ${command}${entry.description === undefined ? '' : `  — ${entry.description}`}`);
    }
    return 0;
  },
});
