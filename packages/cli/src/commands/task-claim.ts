import { defineCommand } from '../define-command.js';
import { printJson, printKv } from '../output.js';

export const taskClaimCommand = defineCommand({
  name: 'mediforce task claim',
  description: 'Claim a pending human task for the caller.',
  args: {
    taskId: { type: 'positional', required: true, description: 'Task id' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.tasks.claim({ taskId: args.taskId });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Task ${result.task.id} claimed`);
    printKv(output, [
      ['status', result.task.status],
      ['assignedUser', result.task.assignedUserId ?? '(unassigned)'],
    ]);
    return 0;
  },
});
