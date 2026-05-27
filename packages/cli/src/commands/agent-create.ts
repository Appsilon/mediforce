import { readFileSync } from 'node:fs';
import { defineCommand } from '../define-command.js';
import { printJson, printError } from '../output.js';

export const agentCreateCommand = defineCommand({
  name: 'mediforce agent create',
  description:
    'Create an agent definition from a JSON file (matches CreateAgentDefinitionInput: name, foundationModel, systemPrompt, etc.).',
  args: {
    file: {
      type: 'string',
      required: true,
      description: 'Path to a JSON file with the agent definition',
    },
    namespace: {
      type: 'string',
      description: 'Target namespace (overrides any `namespace` in the file)',
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
    const body = typeof raw === 'object' && raw !== null ? { ...(raw as Record<string, unknown>) } : {};
    if (args.namespace !== undefined) body.namespace = args.namespace;

    const result = await mediforce.agents.create(body as never);
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Agent ${result.agent.id} created (${result.agent.name})`);
    return 0;
  },
});
