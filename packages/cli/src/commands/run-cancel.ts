import { defineCommand } from '../define-command.js';
import { printJson } from '../output.js';

export const runCancelCommand = defineCommand({
  name: 'mediforce run cancel',
  description: 'Cancel a running or paused workflow run.',
  args: {
    runId: {
      type: 'positional',
      required: true,
      description: 'Run ID',
    },
    reason: { type: 'string', description: 'Cancellation reason recorded on the run + audit event' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.runs.cancel({
      runId: args.runId,
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Run ${result.run.id} cancelled`);
    output.stdout(`  status:  ${result.run.status}`);
    output.stdout(`  reason:  ${result.run.error ?? '(none)'}`);
    return 0;
  },
});
