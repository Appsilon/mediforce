import { defineCommand } from '../define-command.js';
import { printJson, printError } from '../output.js';

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

export const secretDeleteCommand = defineCommand({
  name: 'secret delete',
  help: HELP,
  options: {
    workflow: { type: 'string' },
    namespace: { type: 'string' },
    key: { type: 'string' },
    'base-url': { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } as const,
  handler: async ({ flags, mediforce, output, jsonMode }) => {
    if (!flags.namespace || !flags.key) {
      printError(output, { error: '--namespace and --key are required' }, jsonMode);
      output.stderr('');
      output.stderr(HELP);
      return 2;
    }

    await mediforce.secrets.delete({
      namespace: flags.namespace,
      ...(flags.workflow ? { workflow: flags.workflow } : {}),
      key: flags.key,
    });
    if (jsonMode) {
      printJson(output, { ok: true });
    } else {
      const scope = flags.workflow
        ? `workflow "${flags.workflow}" in namespace "${flags.namespace}"`
        : `namespace "${flags.namespace}"`;
      output.stdout(`Secret "${flags.key}" deleted from ${scope}.`);
    }
    return 0;
  },
});
