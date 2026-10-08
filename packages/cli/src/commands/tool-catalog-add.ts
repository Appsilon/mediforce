import { readFileSync } from 'node:fs';
import { CreateToolCatalogEntryInputApiSchema } from '@mediforce/platform-api/contract';
import { DEFAULT_AGENT_IMAGE } from '@mediforce/platform-core';
import { defineCommand } from '../define-command';
import { printJson, printError } from '../output';

export const toolCatalogAddCommand = defineCommand({
  name: 'mediforce tool-catalog add',
  description:
    'Add an MCP server to a workspace Tool Catalog from a JSON file — stdio (type "stdio" or omitted; id, command, args, env, description) ' +
    'or HTTP (type "http"; id, url, auth, description).',
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
    } else {
      output.stdout(`Added '${result.entry.id}' to the ${parsed.data.namespace} Tool Catalog.`);
    }

    // Advisory: a step runs this command in an image, and the default one may
    // not carry it. The add already succeeded, so a failed check says nothing.
    // The warning goes to stderr, which keeps `--json` stdout a single document.
    const entry = result.entry;
    if (entry.type !== 'stdio') return 0;
    const check = await mediforce.imageCatalog
      .checkCommand({ namespace: parsed.data.namespace, image: DEFAULT_AGENT_IMAGE, command: entry.command })
      .catch(() => undefined);
    if (check?.status === 'known' && check.available === false) {
      output.stderr(
        `Warning: \`${entry.command}\` is not available in the default agent image (${DEFAULT_AGENT_IMAGE}). ` +
          'A step using an agent bound to this server needs an image that provides it — ' +
          `\`mediforce images check-command --namespace ${parsed.data.namespace} --command ${entry.command} --image <image>\`.`,
      );
    }
    return 0;
  },
});
