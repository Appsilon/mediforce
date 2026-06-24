import { defineCommand } from '../define-command';
import { printJson, printKv } from '../output';

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
    printKv(output, [
      ['Effective remaining', `$${data.effectiveRemaining.toFixed(2)}`],
      ['Key limit remaining', `$${data.remaining.toFixed(2)}`],
      [
        'Account credits remaining',
        data.accountRemaining === undefined
          ? 'unavailable'
          : `$${data.accountRemaining.toFixed(2)}`,
      ],
      ['Key used', `$${data.usage.toFixed(2)}`],
      ['Key limit', `$${data.limit.toFixed(2)}`],
    ]);
    return 0;
  },
});
