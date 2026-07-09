import { readFileSync } from 'node:fs';
import { CreateAgentInputSchema } from '@mediforce/platform-api/contract';
import { defineCommand } from '../define-command';
import { printJson, printError } from '../output';

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
    const rawObject = typeof raw === 'object' && raw !== null ? { ...(raw as Record<string, unknown>) } : {};
    if (args.namespace !== undefined) rawObject.namespace = args.namespace;
    const parsed = CreateAgentInputSchema.safeParse(rawObject);
    if (!parsed.success) {
      printError(output, { error: `invalid agent definition: ${parsed.error.message}` }, jsonMode);
      return 1;
    }

    const result = await mediforce.agents.create(parsed.data);
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Agent ${result.agent.id} created (${result.agent.name})`);
    return 0;
  },
});
