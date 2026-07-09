import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const configSetCommand = defineCommand({
  name: 'mediforce config set',
  description: 'Set a platform configuration value.',
  args: {
    key: { type: 'positional', required: true, description: 'Config key (e.g. alert.webhook.url)' },
    value: { type: 'positional', required: true, description: 'Config value' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const key = args.key as string;
    const value = args.value as string;
    await mediforce.config.set({ key, value });
    if (jsonMode) {
      printJson(output, { ok: true });
    } else {
      output.stdout(`Set ${key} = ${value}`);
    }
    return 0;
  },
});
