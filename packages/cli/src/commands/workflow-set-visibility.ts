import { defineCommand, enumArg } from '../define-command.js';
import { printJson } from '../output.js';

export const workflowSetVisibilityCommand = defineCommand({
  name: 'mediforce workflow set-visibility',
  description: 'Set the visibility of a workflow definition.',
  args: {
    name: {
      type: 'positional',
      required: true,
      description: 'Workflow definition name',
    },
    visibility: enumArg(['public', 'private'] as const, {
      required: true,
      description: 'Visibility level (public | private)',
    }),
    namespace: { type: 'string', required: true, description: 'Workspace handle' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    // `required: true` on the enumArg — citty enforces at parse time.
    const visibility = args.visibility!;
    const namespace = args.namespace!;
    const result = await mediforce.workflows.setVisibility(
      { name: args.name, visibility },
      { namespace },
    );
    if (jsonMode) {
      printJson(output, result);
    } else {
      output.stdout(`Set ${result.name} visibility to ${result.visibility}`);
    }
    return 0;
  },
});
