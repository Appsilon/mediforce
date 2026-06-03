import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const configGetCommand = defineCommand({
  name: 'mediforce config get',
  description: 'Get a platform configuration value. Append * to key for prefix lookup.',
  args: {
    key: {
      type: 'positional',
      required: true,
      description: 'Config key (e.g. alert.webhook.url) or prefix with wildcard (e.g. alert.*)',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const key = args.key as string;

    if (key.endsWith('*')) {
      const prefix = key.slice(0, -1);
      const result = await mediforce.config.getByPrefix({ prefix });
      if (jsonMode) {
        printJson(output, result);
      } else {
        if (result.settings.length === 0) {
          output.stdout(`No settings found with prefix: ${prefix}`);
        } else {
          for (const setting of result.settings) {
            output.stdout(`${setting.key} = ${setting.value}`);
          }
        }
      }
      return 0;
    }

    const result = await mediforce.config.get({ key });
    if (jsonMode) {
      printJson(output, result);
    } else {
      if (result.value !== null) {
        output.stdout(`${result.key} = ${result.value}`);
      } else {
        output.stdout(`${result.key}: (not set)`);
      }
    }
    return 0;
  },
});
