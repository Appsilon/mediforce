import { defineCommand } from '../define-command';
import { printJson } from '../output';

const STATUS_ICONS: Record<string, string> = {
  running: '●',
  completed: '✓',
  timed_out: '⏱',
  low_confidence: '?',
  error: '✗',
  escalated: '↑',
  flagged: '⚐',
  paused: '⏸',
};

export const agentRunListCommand = defineCommand({
  name: 'mediforce agent-run list',
  description: 'List recent agent runs, optionally filtered by workspace / run / step.',
  args: {
    namespace: { type: 'string', description: 'Filter by workspace handle' },
    'run-id': { type: 'string', description: 'Filter by parent process-instance id' },
    'step-id': { type: 'string', description: 'Filter by stepId (requires --run-id)' },
    limit: { type: 'string', description: 'Max results (default: 50, max: 200)' },
    cursor: { type: 'string', description: 'Opaque pagination token from prior nextCursor' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const stepId = args['step-id'];
    const runIdFilter = args['run-id'];
    if (stepId !== undefined && runIdFilter === undefined) {
      output.stderr('--step-id requires --run-id');
      return 2;
    }
    const result = await mediforce.agentRuns.list({
      ...(args.namespace !== undefined ? { namespace: args.namespace } : {}),
      ...(runIdFilter !== undefined ? { runId: runIdFilter } : {}),
      ...(stepId !== undefined ? { stepId } : {}),
      ...(args.limit !== undefined ? { limit: Number(args.limit) } : { limit: 50 }),
      ...(args.cursor !== undefined ? { cursor: args.cursor } : {}),
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.runs.length === 0) {
      output.stdout('No agent runs found.');
      return 0;
    }
    for (const run of result.runs) {
      const icon = STATUS_ICONS[run.status] ?? '?';
      output.stdout(
        `${icon} ${run.status.padEnd(14)} ${run.id}  step:${run.stepId}  plugin:${run.pluginId}  instance:${run.processInstanceId}`,
      );
    }
    if (result.nextCursor !== undefined) {
      output.stdout(`\nNext page: --cursor ${result.nextCursor}`);
    }
    return 0;
  },
});
