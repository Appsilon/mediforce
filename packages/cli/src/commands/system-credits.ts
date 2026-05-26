import { defineCommand } from '../define-command.js';
import { printJson, printError } from '../output.js';

const HELP = `Usage: mediforce system credits --namespace <ns> [options]

Show OpenRouter credit balance for a workspace.
Reads the OPENROUTER_API_KEY from workspace secrets and queries OpenRouter.

Required flags:
  --namespace <ns>    Namespace handle

Optional flags:
  --base-url <url>    API base URL (default: http://localhost:9003)
  --json              Emit JSON instead of human-readable output
  --help, -h          Show this help text
`;

export const systemCreditsCommand = defineCommand({
  name: 'system credits',
  help: HELP,
  options: {
    namespace: { type: 'string' },
    'base-url': { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } as const,
  skipClientWhen: (flags) => !flags.namespace,
  handler: async ({ flags, mediforce, output, jsonMode }) => {
    if (!flags.namespace) {
      printError(output, { error: '--namespace is required' }, jsonMode);
      output.stderr('');
      output.stderr(HELP);
      return 2;
    }

    const data = await mediforce!.system.credits({ namespace: flags.namespace });

    if (jsonMode) {
      printJson(output, data);
      return 0;
    }

    if (!data.available) {
      output.stderr(data.error ?? 'OpenRouter credits not available.');
      return 1;
    }

    output.stdout(`OpenRouter credits for namespace "${flags.namespace}":\n`);
    output.stdout(`  Remaining:  $${data.remaining.toFixed(2)}`);
    output.stdout(`  Used:       $${data.usage.toFixed(2)}`);
    output.stdout(`  Limit:      $${data.limit.toFixed(2)}`);
    return 0;
  },
});
