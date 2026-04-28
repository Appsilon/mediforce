import { parseArgs } from 'node:util';
import { Mediforce, ApiError } from '@mediforce/platform-api/client';
import { resolveConfig } from '../config.js';
import { printJson, printError, type OutputSink } from '../output.js';

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

const HELP = `Usage: mediforce workflow list [options]

List every registered workflow definition (latest version per name).

Optional flags:
  --base-url <url>     API base URL (default: http://localhost:9003)
  --json               Emit JSON instead of human-readable output
  --help, -h           Show this help text
`;

const LIST_OPTIONS = {
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export async function workflowListCommand(input: CommandInput): Promise<number> {
  let flags: {
    'base-url'?: string;
    json?: boolean;
    help?: boolean;
  };
  try {
    const parsed = parseArgs({
      args: input.argv,
      options: LIST_OPTIONS,
      strict: true,
      allowPositionals: false,
    });
    flags = parsed.values;
  } catch (err) {
    input.output.stderr(`mediforce workflow list: ${String(err)}`);
    input.output.stderr('');
    input.output.stderr(HELP);
    return 2;
  }
  const jsonMode = flags.json === true;

  if (flags.help === true) {
    input.output.stdout(HELP);
    return 0;
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
    const result = await mediforce.workflows.list();
    if (jsonMode) {
      printJson(input.output, result);
      return 0;
    }
    if (result.definitions.length === 0) {
      input.output.stdout('No workflow definitions registered.');
      return 0;
    }
    input.output.stdout(`Found ${String(result.definitions.length)} workflow(s):`);
    for (const group of result.definitions) {
      const defaultLabel =
        group.defaultVersion === null
          ? 'no default'
          : `default: v${String(group.defaultVersion)}`;
      input.output.stdout(
        `  ${group.name}  latest: v${String(group.latestVersion)}  (${defaultLabel})`,
      );
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
