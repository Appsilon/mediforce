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

const HELP = `Usage: mediforce secret list --namespace <ns> [--workflow <name>] [options]

List secret key names. Values are never shown.
Without --workflow: lists workspace-level secrets.
With --workflow: lists workflow-level secrets.

Required flags:
  --namespace <ns>    Namespace handle

Optional flags:
  --workflow <name>    Workflow name (omit for workspace-level secrets)
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

  if (!flags.namespace) {
    printError(input.output, { error: '--namespace is required' }, jsonMode);
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
      ...(flags.workflow ? { workflow: flags.workflow } : {}),
    });
    if (jsonMode) {
      printJson(input.output, result);
      return 0;
    }
    const scope = flags.workflow
      ? `workflow "${flags.workflow}" in namespace "${flags.namespace}"`
      : `namespace "${flags.namespace}"`;
    if (result.keys.length === 0) {
      input.output.stdout(`No secrets configured for ${scope}.`);
      return 0;
    }
    input.output.stdout(`Secrets for ${scope} (${String(result.keys.length)}):\n`);
    for (const key of result.keys) {
      input.output.stdout(`  ${key}`);
    }
    return 0;
  } catch (err) {
    printError(input.output, formatCliError(err, { baseUrl: config.baseUrl, jsonMode }), jsonMode);
    return 1;
  }
}
