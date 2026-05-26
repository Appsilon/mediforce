import { defineCommand } from '../define-command.js';
import { printJson, printError } from '../output.js';

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

export const secretListCommand = defineCommand({
  name: 'secret list',
  help: HELP,
  options: {
    workflow: { type: 'string' },
    namespace: { type: 'string' },
    'base-url': { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } as const,
  handler: async ({ flags, mediforce, output, jsonMode }) => {
    if (!flags.namespace) {
      printError(output, { error: '--namespace is required' }, jsonMode);
      output.stderr('');
      output.stderr(HELP);
      return 2;
    }

    const result = await mediforce.secrets.list({
      namespace: flags.namespace,
      ...(flags.workflow ? { workflow: flags.workflow } : {}),
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    const scope = flags.workflow
      ? `workflow "${flags.workflow}" in namespace "${flags.namespace}"`
      : `namespace "${flags.namespace}"`;
    if (result.keys.length === 0) {
      output.stdout(`No secrets configured for ${scope}.`);
      return 0;
    }
    output.stdout(`Secrets for ${scope} (${String(result.keys.length)}):\n`);
    for (const key of result.keys) {
      output.stdout(`  ${key}`);
    }
    return 0;
  },
});
