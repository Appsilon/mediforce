import { parseArgs } from 'node:util';
import { Mediforce, ApiError } from '@mediforce/platform-api/client';
import { resolveConfig } from '../config.js';
import { printJson, printError, type OutputSink } from '../output.js';

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

const HELP = `Usage: mediforce secret delete --namespace <ns> --key <key> [--workflow <name>] [options]

Delete a single secret.
Without --workflow: deletes a workspace-level secret.
With --workflow: deletes a workflow-level secret.

Required flags:
  --namespace <ns>    Namespace handle
  --key <key>         Secret key name to delete

Optional flags:
  --workflow <name>    Workflow name (omit for workspace-level secret)
  --base-url <url>    API base URL (default: http://localhost:9003)
  --json              Emit JSON instead of human-readable output
  --help, -h          Show this help text
`;

const DELETE_OPTIONS = {
  workflow: { type: 'string' },
  namespace: { type: 'string' },
  key: { type: 'string' },
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export async function secretDeleteCommand(input: CommandInput): Promise<number> {
  let flags: {
    workflow?: string;
    namespace?: string;
    key?: string;
    'base-url'?: string;
    json?: boolean;
    help?: boolean;
  };
  try {
    const parsed = parseArgs({
      args: input.argv,
      options: DELETE_OPTIONS,
      strict: true,
      allowPositionals: false,
    });
    flags = parsed.values;
  } catch (err) {
    input.output.stderr(`mediforce secret delete: ${String(err)}`);
    input.output.stderr('');
    input.output.stderr(HELP);
    return 2;
  }
  const jsonMode = flags.json === true;

  if (flags.help === true) {
    input.output.stdout(HELP);
    return 0;
  }

  if (!flags.namespace || !flags.key) {
    printError(input.output, { error: '--namespace and --key are required' }, jsonMode);
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
    await mediforce.secrets.delete({
      namespace: flags.namespace,
      ...(flags.workflow ? { workflow: flags.workflow } : {}),
      key: flags.key,
    });
    if (jsonMode) {
      printJson(input.output, { ok: true });
    } else {
      const scope = flags.workflow
        ? `workflow "${flags.workflow}" in namespace "${flags.namespace}"`
        : `namespace "${flags.namespace}"`;
      input.output.stdout(`Secret "${flags.key}" deleted from ${scope}.`);
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
