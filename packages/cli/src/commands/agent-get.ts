import { defineCommand } from '../define-command';
import { printJson, printKv } from '../output';

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
    printKv(output, [
      ['name', agent.name],
      ['kind', agent.kind],
      ['model', agent.foundationModel],
      ['description', agent.description],
      ['runtimeId', agent.runtimeId],
      ['visibility', agent.visibility],
      ['namespace', agent.namespace],
    ]);
    return 0;
  },
});
