import { defineCommand, enumArg } from '../define-command';
import { printJson } from '../output';

const STATUS_ICONS: Record<string, string> = {
  created: '○',
  running: '●',
  paused: '⏸',
  completed: '✓',
  failed: '✗',
};

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

export const runListCommand = defineCommand({
  name: 'mediforce run list',
  description: 'List recent runs, optionally filtered by workflow name or status.',
  args: {
    workflow: { type: 'string', description: 'Filter by workflow definition name' },
    status: enumArg(['created', 'running', 'paused', 'completed', 'failed'] as const, {
      description: 'Filter by status',
    }),
    limit: { type: 'string', description: 'Max results (default: 20, max: 100)' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.runs.list({
      workflow: args.workflow,
      status: args.status,
      limit: args.limit !== undefined ? Number(args.limit) : 20,
    });

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.runs.length === 0) {
      output.stdout('No runs found.');
      return 0;
    }
    for (const run of result.runs) {
      const icon = STATUS_ICONS[run.status] ?? '?';
      const age = formatAge(run.createdAt);
      const isTerminal = run.status === 'completed' || run.status === 'failed';
      const costLabel = run.totalCostUsd != null
        ? `  $${run.totalCostUsd.toFixed(4)}${isTerminal ? '' : '+'}`
        : '';
      output.stdout(
        `${icon} ${run.status.padEnd(10)} ${run.id}  ${run.definitionName} v${run.definitionVersion}${costLabel}  ${age}`,
      );
      if (run.currentStepId !== null) output.stdout(`  step: ${run.currentStepId}`);
      if (run.error !== null) output.stdout(`  error: ${run.error}`);
    }
    return 0;
  },
});
