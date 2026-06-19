import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const emailStatusCommand = defineCommand({
  name: 'mediforce email status',
  description: 'Show the configured email provider and its status.',
  args: {},
  async run({ output, mediforce, jsonMode }) {
    const data = await mediforce.system.emailStatus();
    if (jsonMode) {
      printJson(output, data);
      return 0;
    }
    if (data.provider === null) {
      output.stdout('Email: not configured');
      return 0;
    }
    output.stdout(`Email provider: ${data.provider}`);
    output.stdout(`From address:   ${data.from ?? '(not set)'}`);
    output.stdout(`Status:         ${data.configured ? 'configured' : 'not configured'}`);
    return 0;
  },
});
