import { defineCommand, enumArg } from '../define-command.js';
import { printJson } from '../output.js';

export const agentSetVisibilityCommand = defineCommand({
  name: 'mediforce agent set-visibility',
  description: 'Set the visibility of an agent definition.',
  args: {
    id: {
      type: 'positional',
      required: true,
      description: 'Agent definition ID',
    },
    visibility: enumArg(['public', 'private'] as const, {
      required: true,
      description: 'Visibility level (public | private)',
    }),
  },
  async run({ args, output, mediforce, jsonMode }) {
    // `required: true` on the enumArg — citty enforces at parse time.
    const visibility = args.visibility!;
    const result = await mediforce.agents.update({ id: args.id }, { visibility });
    if (jsonMode) {
      printJson(output, result);
    } else {
      output.stdout(`Set agent ${args.id} visibility to ${visibility}`);
    }
    return 0;
  },
});
