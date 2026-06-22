import { defineCommand, enumArg } from '../define-command';
import { printJson } from '../output';

const STATUS_ICONS: Record<string, string> = {
  active: '●',
  finalized: '✓',
  abandoned: '✗',
};

export const coworkListCommand = defineCommand({
  name: 'mediforce cowork list',
  description:
    "List cowork sessions. With no axis flag returns the caller's workspace-visible queue across roles (GitHub-like default).",
  args: {
    role: { type: 'string', description: 'Filter by assignedRole' },
    status: enumArg(['active', 'finalized', 'abandoned'] as const, {
      description: 'Filter by status (repeat for multiple)',
    }),
  },
  async run({ args, output, mediforce, jsonMode }) {
    const role = args.role;
    const status = args.status !== undefined ? [args.status] : undefined;
    const input = {
      ...(role !== undefined ? { role } : {}),
      ...(status !== undefined ? { status } : {}),
    };

    const result = await mediforce.cowork.list(input);

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.sessions.length === 0) {
      output.stdout('No cowork sessions found.');
      return 0;
    }
    for (const session of result.sessions) {
      const icon = STATUS_ICONS[session.status] ?? '?';
      const assigned = session.assignedUserId !== null ? ` (${session.assignedUserId})` : '';
      output.stdout(
        `${icon} ${session.status.padEnd(10)} ${session.id}  step:${session.stepId}  role:${session.assignedRole}${assigned}`,
      );
    }
    return 0;
  },
});
