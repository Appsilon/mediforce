import { parseArgs } from 'node:util';
import { Mediforce, ApiError } from '@mediforce/platform-api/client';
import { resolveConfig } from '../config.js';
import { printJson, printError, type OutputSink } from '../output.js';

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

const HELP = `Usage: mediforce workflow set-visibility <name> --visibility <public|private> [options]

Set the visibility of a workflow definition.

Positional:
  <name>               Workflow definition name

Required flags:
  --visibility <v>     Visibility level (public | private)

Optional flags:
  --base-url <url>     API base URL (default: http://localhost:9003)
  --json               Emit JSON instead of human-readable output
  --help, -h           Show this help text
`;

const SET_VISIBILITY_OPTIONS = {
  visibility: { type: 'string' },
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export async function workflowSetVisibilityCommand(input: CommandInput): Promise<number> {
  let positionals: string[];
  let flags: {
    visibility?: string;
    'base-url'?: string;
    json?: boolean;
    help?: boolean;
  };
  try {
    const parsed = parseArgs({
      args: input.argv,
      options: SET_VISIBILITY_OPTIONS,
      strict: true,
      allowPositionals: true,
    });
    positionals = parsed.positionals;
    flags = parsed.values;
  } catch (err) {
    input.output.stderr(`mediforce workflow set-visibility: ${String(err)}`);
    input.output.stderr('');
    input.output.stderr(HELP);
    return 2;
  }

  const jsonMode = flags.json === true;

  if (flags.help === true) {
    input.output.stdout(HELP);
    return 0;
  }

  const name = positionals[0];
  if (typeof name !== 'string' || name.length === 0) {
    printError(input.output, { error: '<name> is required' }, jsonMode);
    return 2;
  }

  if (flags.visibility !== 'public' && flags.visibility !== 'private') {
    printError(input.output, { error: '--visibility must be "public" or "private"' }, jsonMode);
    return 2;
  }
  const visibility = flags.visibility;

  let config;
  try {
    config = resolveConfig({ flagBaseUrl: flags['base-url'], env: input.env });
  } catch (err) {
    printError(input.output, { error: String(err) }, jsonMode);
    return 2;
  }

  const mediforce = new Mediforce({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  try {
    const result = await mediforce.workflows.setVisibility({ name, visibility });
    if (jsonMode) {
      printJson(input.output, result);
    } else {
      input.output.stdout(`Set ${result.name} visibility to ${result.visibility}`);
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
