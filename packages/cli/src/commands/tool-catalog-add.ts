import { readFileSync } from 'node:fs';
import { CreateToolCatalogEntryInputApiSchema } from '@mediforce/platform-api/contract';
import { defineCommand } from '../define-command';
import { printJson, printError } from '../output';

export const toolCatalogAddCommand = defineCommand({
  name: 'mediforce tool-catalog add',
  description:
    'Add an MCP server to a workspace Tool Catalog from a JSON file (id, command, args, env, description). Admin only.',
  args: {
    file: {
      type: 'string',
      required: true,
      description: 'Path to a JSON file with the catalog entry',
    },
    namespace: {
      type: 'string',
      description: 'Target workspace (overrides any `namespace` in the file)',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(args.file, 'utf-8'));
    } catch (err) {
      printError(output, { error: `failed to read ${args.file}: ${String(err)}` }, jsonMode);
      return 1;
    }
    const rawObject = typeof raw === 'object' && raw !== null ? { ...(raw as Record<string, unknown>) } : {};
    if (args.namespace !== undefined) rawObject.namespace = args.namespace;
    const parsed = CreateToolCatalogEntryInputApiSchema.safeParse(rawObject);
    if (!parsed.success) {
      printError(output, { error: `invalid catalog entry: ${parsed.error.message}` }, jsonMode);
      return 1;
    }

    const result = await mediforce.toolCatalog.create(parsed.data);
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Added '${result.entry.id}' to the ${parsed.data.namespace} Tool Catalog.`);
    return 0;
  },
});
