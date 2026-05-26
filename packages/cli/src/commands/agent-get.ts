import { defineCommand } from '../define-command.js';
import { printJson } from '../output.js';

export const agentGetCommand = defineCommand({
  name: 'mediforce agent get',
  description: 'Fetch an agent definition by ID.',
  args: {
    id: {
      type: 'positional',
      required: true,
      description: 'Agent definition ID',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.agents.get({ id: args.id });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    const agent = result.agent;
    output.stdout(`Agent ${agent.id}`);
    output.stdout(`  name:          ${agent.name}`);
    output.stdout(`  kind:          ${agent.kind}`);
    output.stdout(`  model:         ${agent.foundationModel}`);
    output.stdout(`  description:   ${agent.description}`);
    if (agent.runtimeId !== undefined) {
      output.stdout(`  runtimeId:     ${agent.runtimeId}`);
    }
    if (agent.visibility !== undefined) {
      output.stdout(`  visibility:    ${agent.visibility}`);
    }
    if (agent.namespace !== undefined) {
      output.stdout(`  namespace:     ${agent.namespace}`);
    }
    if (agent.skillFileNames.length > 0) {
      output.stdout(`  skills:        ${agent.skillFileNames.join(', ')}`);
    }
    return 0;
  },
});
