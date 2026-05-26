import { defineCommand } from '../define-command.js';
import { printJson, printError } from '../output.js';

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

function readStdinDefault(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').trim()));
    process.stdin.on('error', reject);
  });
}

export const secretSetCommand = defineCommand({
  name: 'secret set',
  help: HELP,
  options: {
    workflow: { type: 'string' },
    namespace: { type: 'string' },
    key: { type: 'string' },
    value: { type: 'string' },
    stdin: { type: 'boolean' },
    'base-url': { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } as const,
  handler: async ({ flags, mediforce, output, jsonMode, stdin }) => {
    if (!flags.namespace || !flags.key) {
      printError(output, { error: '--namespace and --key are required' }, jsonMode);
      output.stderr('');
      output.stderr(HELP);
      return 2;
    }

    const hasValue = typeof flags.value === 'string' && flags.value.length > 0;
    const hasStdin = flags.stdin === true;
    if (!hasValue && !hasStdin) {
      printError(output, { error: 'Provide --value or --stdin' }, jsonMode);
      return 2;
    }
    if (hasValue && hasStdin) {
      printError(output, { error: 'Cannot use both --value and --stdin' }, jsonMode);
      return 2;
    }

    let secretValue: string;
    if (hasStdin) {
      const readStdin = stdin ?? readStdinDefault;
      secretValue = await readStdin();
      if (secretValue.length === 0) {
        printError(output, { error: 'stdin was empty — no value to set' }, jsonMode);
        return 1;
      }
    } else {
      secretValue = flags.value!;
    }

    await mediforce.secrets.set({
      namespace: flags.namespace,
      ...(flags.workflow ? { workflow: flags.workflow } : {}),
      key: flags.key,
      value: secretValue,
    });
    if (jsonMode) {
      printJson(output, { ok: true });
    } else {
      const scope = flags.workflow
        ? `workflow "${flags.workflow}" in namespace "${flags.namespace}"`
        : `namespace "${flags.namespace}"`;
      output.stdout(`Secret "${flags.key}" set for ${scope}.`);
    }
    return 0;
  },
});
