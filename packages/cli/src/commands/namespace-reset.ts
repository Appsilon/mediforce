import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const namespaceResetCommand = defineCommand({
  name: 'mediforce namespace reset',
  description:
    'Delete every workflow in a workspace (and its runs and tasks). The workspace and its members survive. Owner only.',
  args: {
    handle: { type: 'string', required: true, description: 'Workspace handle' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.namespaces.reset({ handle: args.handle });

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }

    output.stdout(
      `Reset namespace ${result.handle} — deleted ${result.deletedWorkflows} workflow(s) and ${result.deletedRuns} run(s)`,
    );
    return 0;
  },
});
