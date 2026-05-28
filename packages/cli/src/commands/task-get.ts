import { defineCommand } from '../define-command.js';
import { printJson } from '../output.js';

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
    output.stdout(`  status:        ${task.status}`);
    output.stdout(`  role:          ${task.assignedRole}`);
    output.stdout(`  assignedUser:  ${task.assignedUserId ?? '(unassigned)'}`);
    output.stdout(`  instance:      ${task.processInstanceId}`);
    output.stdout(`  step:          ${task.stepId}`);
    output.stdout(`  created:       ${task.createdAt}`);
    if (task.completedAt !== null) {
      output.stdout(`  completed:     ${task.completedAt}`);
    }
    return 0;
  },
});
