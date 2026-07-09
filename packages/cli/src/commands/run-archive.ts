import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const runArchiveCommand = defineCommand({
  name: 'mediforce run archive',
  description: 'Soft-archive (or restore) a workflow run. Blocked while the run is active.',
  args: {
    runId: {
      type: 'positional',
      required: true,
      description: 'Run ID',
    },
    unarchive: {
      type: 'boolean',
      description: 'Set archived=false (restore a previously archived run)',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const archived = args.unarchive !== true;
    const result = await mediforce.runs.archive({ runId: args.runId, archived });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Run ${result.run.id} ${archived ? 'archived' : 'unarchived'}`);
    return 0;
  },
});
