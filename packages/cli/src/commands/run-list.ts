import { defineCommand } from '../define-command.js';
import { printJson, printError } from '../output.js';

const HELP = `Usage: mediforce run list [options]

List recent runs, optionally filtered by workflow name or status.

Optional flags:
  --workflow <name>    Filter by workflow definition name
  --status <status>    Filter by status (created|running|paused|completed|failed)
  --limit <n>          Max results (default: 20, max: 100)
  --base-url <url>     API base URL (default: http://localhost:9003)
  --json               Emit JSON instead of human-readable output
  --help, -h           Show this help text
`;

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
  name: 'run list',
  help: HELP,
  options: {
    workflow: { type: 'string' },
    status: { type: 'string' },
    limit: { type: 'string' },
    'base-url': { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } as const,
  handler: async ({ flags, mediforce, output, jsonMode }) => {
    const validStatuses = new Set(['created', 'running', 'paused', 'completed', 'failed']);
    if (flags.status !== undefined && !validStatuses.has(flags.status)) {
      printError(
        output,
        { error: `Invalid status: ${flags.status}. Must be one of: ${[...validStatuses].join(', ')}` },
        jsonMode,
      );
      return 2;
    }

    const result = await mediforce.runs.list({
      workflow: flags.workflow,
      status: flags.status as 'created' | 'running' | 'paused' | 'completed' | 'failed' | undefined,
      limit: flags.limit !== undefined ? Number(flags.limit) : 20,
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
        `${icon} ${run.status.padEnd(10)} ${run.runId}  ${run.definitionName} v${run.definitionVersion}${costLabel}  ${age}`,
      );
      if (run.currentStepId !== null) {
        output.stdout(`  step: ${run.currentStepId}`);
      }
      if (run.error !== null) {
        output.stdout(`  error: ${run.error}`);
      }
    }
    return 0;
  },
});
