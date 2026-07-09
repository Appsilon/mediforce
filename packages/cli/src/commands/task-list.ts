import { defineCommand, enumArg } from '../define-command';
import { printJson } from '../output';

const STATUS_ICONS: Record<string, string> = {
  pending: '○',
  claimed: '●',
  completed: '✓',
  cancelled: '✗',
};

export const taskListCommand = defineCommand({
  name: 'mediforce task list',
  description:
    'List human tasks. With no axis flag returns the caller\'s workspace-visible queue across roles (GitHub-like default).',
  args: {
    role: { type: 'string', description: 'Filter by assignedRole (mutually exclusive with --instance-id)' },
    'instance-id': { type: 'string', description: 'Filter by process instance (mutually exclusive with --role)' },
    'step-id': { type: 'string', description: 'Narrow to a specific step within the chosen base set' },
    status: enumArg(['pending', 'claimed', 'completed', 'cancelled'] as const, {
      description: 'Filter by status (repeat for multiple)',
    }),
  },
  async run({ args, output, mediforce, jsonMode }) {
    const role = args.role;
    const instanceId = args['instance-id'];
    if (role !== undefined && instanceId !== undefined) {
      output.stderr('--role and --instance-id are mutually exclusive.');
      return 2;
    }
    const status = args.status !== undefined ? [args.status] : undefined;
    const stepId = args['step-id'];

    const filters = {
      ...(stepId !== undefined ? { stepId } : {}),
      ...(status !== undefined ? { status } : {}),
    };
    const input =
      instanceId !== undefined
        ? { instanceId, ...filters }
        : role !== undefined
          ? { role, ...filters }
          : filters;

    const result = await mediforce.tasks.list(input);

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.tasks.length === 0) {
      output.stdout('No tasks found.');
      return 0;
    }
    for (const task of result.tasks) {
      const icon = STATUS_ICONS[task.status] ?? '?';
      const assigned = task.assignedUserId !== null ? ` (${task.assignedUserId})` : '';
      output.stdout(
        `${icon} ${task.status.padEnd(10)} ${task.id}  step:${task.stepId}  role:${task.assignedRole}${assigned}`,
      );
    }
    return 0;
  },
});
