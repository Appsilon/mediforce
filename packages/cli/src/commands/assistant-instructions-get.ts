import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const assistantInstructionsGetCommand = defineCommand({
  name: 'mediforce assistant instructions-get',
  description:
    "Show one person's standing instructions for the workflow assistant in a workspace.",
  args: {
    namespace: { type: 'string', required: true, description: 'Workspace handle' },
    uid: {
      type: 'string',
      description: 'Whose instructions to read (required when authenticated via apiKey)',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.assistant.getInstructions({
      namespace: args.namespace,
      ...(args.uid !== undefined ? { uid: args.uid } : {}),
    });

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.instructions === '') {
      output.stdout(`No assistant instructions saved for workspace "${args.namespace}".`);
      return 0;
    }
    output.stdout(result.instructions);
    return 0;
  },
});
