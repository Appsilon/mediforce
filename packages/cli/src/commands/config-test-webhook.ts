import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const configTestWebhookCommand = defineCommand({
  name: 'mediforce config test-webhook',
  description: 'Send a test notification to the configured webhook URL.',
  args: {},
  async run({ output, mediforce, jsonMode }) {
    const result = await mediforce.config.testWebhook();
    if (jsonMode) {
      printJson(output, result);
      return result.ok ? 0 : 1;
    }
    if (result.ok) {
      output.stdout('Webhook test sent successfully.');
    } else {
      output.stderr(`Webhook test failed: ${result.error ?? 'Unknown error'}`);
      return 1;
    }
    return 0;
  },
});
