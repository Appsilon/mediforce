import { defineCommand } from '../define-command';
import { printJson, printKv } from '../output';

export const usersClearMustChangePasswordCommand = defineCommand({
  name: 'mediforce users clear-must-change-password',
  description: 'Acknowledge a forced password change (apiKey: pass --uid).',
  args: {
    uid: { type: 'string', description: 'Target uid (required when authenticated via apiKey)' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.users.clearMustChangePassword(
      args.uid !== undefined ? { uid: args.uid } : undefined,
    );

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }

    output.stdout(`Cleared mustChangePassword for ${result.user.uid}`);
    printKv(output, [['mustChangePassword', String(result.user.mustChangePassword)]]);
    return 0;
  },
});
