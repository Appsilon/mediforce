import { parseArgs } from 'node:util';
import { Mediforce, ApiError } from '@mediforce/platform-api/client';
import { resolveConfig } from '../config.js';
import { printJson, printError, type OutputSink } from '../output.js';

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

const HELP = `Usage: mediforce secret list --workflow <name> --namespace <ns> [options]

List secret key names for a workflow. Values are never shown.

Required flags:
  --workflow <name>    Workflow name
  --namespace <ns>    Namespace handle

Optional flags:
  --base-url <url>    API base URL (default: http://localhost:9003)
  --json              Emit JSON instead of human-readable output
  --help, -h          Show this help text
`;

const LIST_OPTIONS = {
  workflow: { type: 'string' },
  namespace: { type: 'string' },
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export async function secretListCommand(input: CommandInput): Promise<number> {
  let flags: {
    workflow?: string;
    namespace?: string;
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
    input.output.stderr(`mediforce secret list: ${String(err)}`);
    input.output.stderr('');
    input.output.stderr(HELP);
    return 2;
  }
  const jsonMode = flags.json === true;

  if (flags.help === true) {
    input.output.stdout(HELP);
    return 0;
  }

  if (!flags.workflow || !flags.namespace) {
    printError(input.output, { error: '--workflow and --namespace are required' }, jsonMode);
    input.output.stderr('');
    input.output.stderr(HELP);
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
    const result = await mediforce.secrets.list({
      namespace: flags.namespace,
      workflow: flags.workflow,
    });
    if (jsonMode) {
      printJson(input.output, result);
      return 0;
    }
    if (result.keys.length === 0) {
      input.output.stdout(`No secrets configured for workflow "${flags.workflow}" in namespace "${flags.namespace}".`);
      return 0;
    }
    input.output.stdout(`Secrets for "${flags.workflow}" (${String(result.keys.length)}):\n`);
    for (const key of result.keys) {
      input.output.stdout(`  ${key}`);
    }
    return 0;
  } catch (err) {
    if (err instanceof ApiError) {
      printError(input.output, { error: err.message, status: err.status, body: err.body }, jsonMode);
    } else {
      printError(input.output, { error: String(err) }, jsonMode);
    }
    return 1;
  }
}
