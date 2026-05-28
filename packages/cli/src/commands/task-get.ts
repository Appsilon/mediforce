import { defineCommand } from '../define-command.js';
import { printJson, printKv } from '../output.js';

export const taskGetCommand = defineCommand({
  name: 'mediforce task get',
  description: 'Fetch a single human task by id.',
  args: {
    taskId: { type: 'positional', required: true, description: 'Task id' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const task = await mediforce.tasks.get({ taskId: args.taskId });
    if (jsonMode) {
      printJson(output, task);
      return 0;
    }
    output.stdout(`Task ${task.id}`);
    printKv(output, [
      ['status', task.status],
      ['role', task.assignedRole],
      ['assignedUser', task.assignedUserId ?? '(unassigned)'],
      ['instance', task.processInstanceId],
      ['step', task.stepId],
      ['created', task.createdAt],
      ['completed', task.completedAt ?? undefined],
    ]);
    return 0;
  },
});
