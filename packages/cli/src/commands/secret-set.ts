import { parseArgs } from 'node:util';
import { Mediforce } from '@mediforce/platform-api/client';
import { resolveConfig } from '../config.js';
import { printJson, printError, type OutputSink } from '../output.js';
import { formatCliError } from '../errors.js';

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
  stdin?: () => Promise<string>;
}

const HELP = `Usage: mediforce secret set --namespace <ns> --key <key> [--workflow <name>] [options]

Set a single secret. The value is encrypted at rest.
Without --workflow: sets a workspace-level secret (shared across all workflows).
With --workflow: sets a workflow-level secret (overrides workspace secrets).

Required flags:
  --namespace <ns>    Namespace handle
  --key <key>         Secret key name

Optional flags:
  --workflow <name>    Workflow name (omit for workspace-level secret)
  --value <val>       Secret value (visible in shell history — prefer --stdin)
  --stdin             Read value from stdin (pipe-friendly, no shell history)
  --base-url <url>    API base URL (default: http://localhost:9003)
  --json              Emit JSON instead of human-readable output
  --help, -h          Show this help text

Examples:
  mediforce secret set --namespace my-ns --key OPENROUTER_API_KEY --value sk-or-...
  mediforce secret set --namespace my-ns --workflow my-wf --key API_TOKEN --value sk-abc
  echo "sk-abc" | mediforce secret set --namespace my-ns --key API_TOKEN --stdin
`;

const SET_OPTIONS = {
  workflow: { type: 'string' },
  namespace: { type: 'string' },
  key: { type: 'string' },
  value: { type: 'string' },
  stdin: { type: 'boolean' },
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

function readStdinDefault(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').trim()));
    process.stdin.on('error', reject);
  });
}

export async function secretSetCommand(input: CommandInput): Promise<number> {
  let flags: {
    workflow?: string;
    namespace?: string;
    key?: string;
    value?: string;
    stdin?: boolean;
    'base-url'?: string;
    json?: boolean;
    help?: boolean;
  };
  try {
    const parsed = parseArgs({
      args: input.argv,
      options: SET_OPTIONS,
      strict: true,
      allowPositionals: false,
    });
    flags = parsed.values;
  } catch (err) {
    input.output.stderr(`mediforce secret set: ${String(err)}`);
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

  const hasValue = typeof flags.value === 'string' && flags.value.length > 0;
  const hasStdin = flags.stdin === true;
  if (!hasValue && !hasStdin) {
    printError(input.output, { error: 'Provide --value or --stdin' }, jsonMode);
    return 2;
  }
  if (hasValue && hasStdin) {
    printError(input.output, { error: 'Cannot use both --value and --stdin' }, jsonMode);
    return 2;
  }

  let secretValue: string;
  if (hasStdin) {
    const readStdin = input.stdin ?? readStdinDefault;
    secretValue = await readStdin();
    if (secretValue.length === 0) {
      printError(input.output, { error: 'stdin was empty — no value to set' }, jsonMode);
      return 1;
    }
  } else {
    secretValue = flags.value!;
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
    await mediforce.secrets.set({
      namespace: flags.namespace,
      ...(flags.workflow ? { workflow: flags.workflow } : {}),
      key: flags.key,
      value: secretValue,
    });
    if (jsonMode) {
      printJson(input.output, { ok: true });
    } else {
      const scope = flags.workflow
        ? `workflow "${flags.workflow}" in namespace "${flags.namespace}"`
        : `namespace "${flags.namespace}"`;
      input.output.stdout(`Secret "${flags.key}" set for ${scope}.`);
    }
    return 0;
  } catch (err) {
    printError(input.output, formatCliError(err, { baseUrl: config.baseUrl, jsonMode }), jsonMode);
    return 1;
  }
}
