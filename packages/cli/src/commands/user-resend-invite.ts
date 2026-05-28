import { defineCommand } from '../define-command.js';
import { printJson } from '../output.js';

export const userResendInviteCommand = defineCommand({
  name: 'mediforce user resend-invite',
  description:
    'Reissue invitation credentials (new temporary password + re-send email) for an existing pending member.',
  args: {
    uid: { type: 'string', required: true, description: 'Firebase user ID of the pending member' },
    namespace: {
      type: 'string',
      required: true,
      description: 'Namespace handle (lowercase alphanumeric + hyphens)',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.users.resendInvite({
      uid: args.uid,
      namespaceHandle: args.namespace,
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Invite resent: ${result.email} (uid: ${result.uid})`);
    output.stdout(`  invitation email:   ${result.emailSent ? 'sent' : 'NOT sent'}`);
    output.stdout(`  temporary password: ${result.temporaryPassword}`);
    return 0;
  },
});
