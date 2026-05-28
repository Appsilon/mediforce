import { defineCommand } from '../define-command.js';
import { printJson, printError } from '../output.js';
import { HumanTaskStatusSchema, type HumanTaskStatus } from '@mediforce/platform-core';
import type { ListTasksInput } from '@mediforce/platform-api/contract';

const VALID_STATUSES = HumanTaskStatusSchema.options;

function parseStatuses(
  raw: string,
  output: { stderr: (s: string) => void },
): HumanTaskStatus[] | null {
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const bad = parts.filter((p) => !(VALID_STATUSES as readonly string[]).includes(p));
  if (bad.length > 0) {
    output.stderr(`Invalid --status values: ${bad.join(', ')} (allowed: ${VALID_STATUSES.join(', ')})`);
    return null;
  }
  return parts as HumanTaskStatus[];
}

function formatAge(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
}

export const taskListCommand = defineCommand({
  name: 'mediforce task list',
  description:
    'List human tasks for a run (--instance) or assigned to a role (--role). Exactly one axis required.',
  args: {
    instance: { type: 'string', description: 'Filter by process instance ID' },
    role: { type: 'string', description: 'Filter by assigned role' },
    step: { type: 'string', description: 'Further narrow by step ID' },
    status: {
      type: 'string',
      description: 'Comma-separated statuses (pending,claimed,completed,cancelled)',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const hasInstance = typeof args.instance === 'string' && args.instance.length > 0;
    const hasRole = typeof args.role === 'string' && args.role.length > 0;
    if (hasInstance === hasRole) {
      printError(output, { error: 'Provide exactly one of --instance or --role' }, jsonMode);
      return 2;
    }

    let statuses: HumanTaskStatus[] | undefined;
    if (typeof args.status === 'string' && args.status.length > 0) {
      const parsed = parseStatuses(args.status, output);
      if (parsed === null) return 2;
      statuses = parsed;
    }

    const input: ListTasksInput = hasInstance
      ? {
          instanceId: args.instance as string,
          ...(args.step !== undefined ? { stepId: args.step } : {}),
          ...(statuses !== undefined ? { status: statuses } : {}),
        }
      : {
          role: args.role as string,
          ...(args.step !== undefined ? { stepId: args.step } : {}),
          ...(statuses !== undefined ? { status: statuses } : {}),
        };

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
      const claimedBy = task.assignedUserId ?? '(unclaimed)';
      const age = formatAge(task.createdAt);
      output.stdout(
        `${task.status.padEnd(10)} ${task.id}  run=${task.processInstanceId}  step=${task.stepId}  role=${task.assignedRole}  ${claimedBy}  ${age}`,
      );
      if (task.deadline !== null) output.stdout(`  deadline: ${task.deadline}`);
    }
    return 0;
  },
});
