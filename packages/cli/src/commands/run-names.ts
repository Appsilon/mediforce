import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const runNamesCommand = defineCommand({
  name: 'mediforce run names',
  description:
    'List projected { id, definitionName } entries for every run in a workspace.',
  args: {
    namespace: {
      type: 'string',
      description: 'Workspace handle to list run names for',
      required: true,
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.runs.listNames({ namespace: args.namespace });

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.runs.length === 0) {
      output.stdout('No runs found.');
      return 0;
    }
    for (const run of result.runs) {
      output.stdout(`${run.id}  ${run.definitionName}`);
    }
    return 0;
  },
});
