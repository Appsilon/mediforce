import { parseArgs } from 'node:util';
import { Mediforce, ApiError } from '@mediforce/platform-api/client';
import { resolveConfig } from '../config.js';
import { printJson, printError, type OutputSink } from '../output.js';

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

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

const RUN_LIST_OPTIONS = {
  workflow: { type: 'string' },
  status: { type: 'string' },
  limit: { type: 'string' },
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

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

export async function runListCommand(input: CommandInput): Promise<number> {
  let flags: {
    workflow?: string;
    status?: string;
    limit?: string;
    'base-url'?: string;
    json?: boolean;
    help?: boolean;
  };
  try {
    const parsed = parseArgs({
      args: input.argv,
      options: RUN_LIST_OPTIONS,
      strict: true,
      allowPositionals: false,
    });
    flags = parsed.values;
  } catch (err) {
    input.output.stderr(`mediforce run list: ${String(err)}`);
    input.output.stderr('');
    input.output.stderr(HELP);
    return 2;
  }
  const jsonMode = flags.json === true;

  if (flags.help === true) {
    input.output.stdout(HELP);
    return 0;
  }

  const validStatuses = new Set(['created', 'running', 'paused', 'completed', 'failed']);
  if (flags.status !== undefined && !validStatuses.has(flags.status)) {
    printError(
      input.output,
      { error: `Invalid status: ${flags.status}. Must be one of: ${[...validStatuses].join(', ')}` },
      jsonMode,
    );
    return 2;
  }

  let config;
  try {
    config = resolveConfig({ flagBaseUrl: flags['base-url'], env: input.env });
  } catch (err) {
    printError(input.output, { error: String(err) }, jsonMode);
    return 2;
  }

  const mediforce = new Mediforce({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  try {
    const result = await mediforce.runs.list({
      workflow: flags.workflow,
      status: flags.status as 'created' | 'running' | 'paused' | 'completed' | 'failed' | undefined,
      limit: flags.limit !== undefined ? Number(flags.limit) : 20,
    });

    if (jsonMode) {
      printJson(input.output, result);
      return 0;
    }

    if (result.runs.length === 0) {
      input.output.stdout('No runs found.');
      return 0;
    }

    for (const run of result.runs) {
      const icon = STATUS_ICONS[run.status] ?? '?';
      const age = formatAge(run.createdAt);
      input.output.stdout(
        `${icon} ${run.status.padEnd(10)} ${run.runId}  ${run.definitionName} v${run.definitionVersion}  ${age}`,
      );
      if (run.currentStepId !== null) {
        input.output.stdout(`  step: ${run.currentStepId}`);
      }
      if (run.error !== null) {
        input.output.stdout(`  error: ${run.error}`);
      }
    }
    return 0;
  } catch (err) {
    if (err instanceof ApiError) {
      printError(
        input.output,
        { error: err.message, status: err.status, body: err.body },
        jsonMode,
      );
    } else {
      printError(input.output, { error: String(err) }, jsonMode);
    }
    return 1;
  }
}
