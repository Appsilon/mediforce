import { defineCommand } from '../define-command';
import { printJson, printError } from '../output';

export const agentDeleteCommand = defineCommand({
  name: 'mediforce agent delete',
  description: 'Delete an agent definition by ID.',
  args: {
    id: {
      type: 'positional',
      required: true,
      description: 'Agent definition ID',
    },
    force: { type: 'boolean', description: 'Confirm deletion (required)' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    if (args.force !== true) {
      const { agent } = await mediforce.agents.get({ id: args.id });
      output.stderr(`About to delete agent ${agent.id}:`);
      output.stderr(`  name:    ${agent.name}`);
      output.stderr(`  model:   ${agent.foundationModel}`);
      if (agent.namespace !== undefined) {
        output.stderr(`  ns:      ${agent.namespace}`);
      }
      output.stderr('');
      printError(output, { error: 'Pass --force to confirm deletion' }, jsonMode);
      return 1;
    }
    const result = await mediforce.agents.delete({ id: args.id });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Deleted agent ${args.id}`);
    return 0;
  },
});
