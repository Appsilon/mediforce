import { parseArgs } from 'node:util';
import { Mediforce, ApiError } from '@mediforce/platform-api/client';
import { resolveConfig } from '../config.js';
import { printJson, printError, type OutputSink } from '../output.js';

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

const HELP = `Usage: mediforce run get <runId> [options]

Fetch the current status of a single run.

Optional flags:
  --base-url <url>     API base URL (default: http://localhost:9003)
  --json               Emit JSON instead of human-readable output
  --help, -h           Show this help text
`;

const RUN_GET_OPTIONS = {
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export async function runGetCommand(input: CommandInput): Promise<number> {
  let flags: {
    'base-url'?: string;
    json?: boolean;
    help?: boolean;
  };
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: input.argv,
      options: RUN_GET_OPTIONS,
      strict: true,
      allowPositionals: true,
    });
    flags = parsed.values;
    positionals = parsed.positionals;
  } catch (err) {
    input.output.stderr(`mediforce run get: ${String(err)}`);
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
    const result = await mediforce.runs.get({ runId });
    if (jsonMode) {
      printJson(input.output, result);
      return 0;
    }
    input.output.stdout(`Run ${result.runId}`);
    input.output.stdout(`  status:        ${result.status}`);
    input.output.stdout(
      `  currentStep:   ${result.currentStepId ?? '(none)'}`,
    );
    input.output.stdout(`  error:         ${result.error ?? '(none)'}`);
    if (result.finalOutput !== null && result.finalOutput !== undefined) {
      input.output.stdout(`  finalOutput:   ${JSON.stringify(result.finalOutput)}`);
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
