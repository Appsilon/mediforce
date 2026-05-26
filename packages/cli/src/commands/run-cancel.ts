import { parseArgs } from 'node:util';
import { Mediforce } from '@mediforce/platform-api/client';
import { resolveConfig } from '../config.js';
import { printJson, printError, type OutputSink } from '../output.js';
import { formatCliError } from '../errors.js';

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

const HELP = `Usage: mediforce run cancel <runId> [options]

Cancel a running or paused workflow run.

Optional flags:
  --reason <text>      Cancellation reason recorded on the run + audit event
  --base-url <url>     API base URL (default: http://localhost:9003)
  --json               Emit JSON instead of human-readable output
  --help, -h           Show this help text
`;

const RUN_CANCEL_OPTIONS = {
  reason: { type: 'string' },
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export async function runCancelCommand(input: CommandInput): Promise<number> {
  let flags: {
    reason?: string;
    'base-url'?: string;
    json?: boolean;
    help?: boolean;
  };
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: input.argv,
      options: RUN_CANCEL_OPTIONS,
      strict: true,
      allowPositionals: true,
    });
    flags = parsed.values;
    positionals = parsed.positionals;
  } catch (err) {
    input.output.stderr(`mediforce run cancel: ${String(err)}`);
    input.output.stderr('');
    input.output.stderr(HELP);
    return 2;
  }
  const jsonMode = flags.json === true;

  if (flags.help === true) {
    input.output.stdout(HELP);
    return 0;
  }

  if (positionals.length === 0) {
    printError(input.output, { error: 'runId is required' }, jsonMode);
    input.output.stderr('');
    input.output.stderr(HELP);
    return 2;
  }
  if (positionals.length > 1) {
    printError(
      input.output,
      { error: `Expected exactly one runId, got ${String(positionals.length)}` },
      jsonMode,
    );
    input.output.stderr('');
    input.output.stderr(HELP);
    return 2;
  }

  const runId = positionals[0]!;

  let config;
  try {
    config = resolveConfig({ flagBaseUrl: flags['base-url'], env: input.env });
  } catch (err) {
    printError(input.output, { error: String(err) }, jsonMode);
    return 2;
  }

  const mediforce = new Mediforce({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  try {
    const result = await mediforce.runs.cancel({
      runId,
      ...(flags.reason !== undefined ? { reason: flags.reason } : {}),
    });
    if (jsonMode) {
      printJson(input.output, result);
      return 0;
    }
    input.output.stdout(`Run ${result.run.id} cancelled`);
    input.output.stdout(`  status:  ${result.run.status}`);
    input.output.stdout(`  reason:  ${result.run.error ?? '(none)'}`);
    return 0;
  } catch (err) {
    printError(input.output, formatCliError(err, { baseUrl: config.baseUrl, jsonMode }), jsonMode);
    return 1;
  }
}
