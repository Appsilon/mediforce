import { defineCommand } from '../define-command.js';
import { printJson } from '../output.js';

export const taskClaimCommand = defineCommand({
  name: 'mediforce task claim',
  description: 'Claim a human task. The caller (API key holder) becomes the assignee.',
  args: {
    taskId: {
      type: 'positional',
      required: true,
      description: 'Task ID',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.tasks.claim({ taskId: args.taskId });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Task ${result.task.id} claimed`);
    output.stdout(`  status:   ${result.task.status}`);
    output.stdout(`  assigned: ${result.task.assignedUserId ?? '(none)'}`);
    return 0;
  },
});
