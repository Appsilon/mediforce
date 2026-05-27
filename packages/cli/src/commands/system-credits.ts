import { defineCommand } from '../define-command.js';
import { printJson } from '../output.js';

export const systemCreditsCommand = defineCommand({
  name: 'mediforce system credits',
  description:
    'Show OpenRouter credit balance for a workspace. Reads OPENROUTER_API_KEY from workspace secrets.',
  args: {
    namespace: { type: 'string', required: true, description: 'Namespace handle' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const data = await mediforce.system.credits({ namespace: args.namespace });

    if (jsonMode) {
      printJson(output, data);
      return 0;
    }

    if (!data.available) {
      output.stderr(data.error ?? 'OpenRouter credits not available.');
      return 1;
    }

    output.stdout(`OpenRouter credits for namespace "${args.namespace}":\n`);
    output.stdout(`  Remaining:  $${data.remaining.toFixed(2)}`);
    output.stdout(`  Used:       $${data.usage.toFixed(2)}`);
    output.stdout(`  Limit:      $${data.limit.toFixed(2)}`);
    return 0;
  },
});
