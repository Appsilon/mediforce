import { defineCommand } from '../define-command.js';
import { printJson, printKv } from '../output.js';

export const usersMeCommand = defineCommand({
  name: 'mediforce users me',
  description: 'Fetch the signed-in user’s profile + workspaces (apiKey: pass --uid).',
  args: {
    uid: { type: 'string', description: 'Target uid (required when authenticated via apiKey)' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.users.me(args.uid !== undefined ? { uid: args.uid } : undefined);

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }

    output.stdout(`User ${result.user.uid}`);
    printKv(output, [
      ['email', result.user.email ?? undefined],
      ['displayName', result.user.displayName ?? undefined],
    ]);
    if (result.namespaces.length === 0) {
      output.stdout('');
      output.stdout('Workspaces: (none)');
      return 0;
    }
    output.stdout('');
    output.stdout(`Workspaces (${result.namespaces.length}):`);
    for (const ns of result.namespaces) {
      output.stdout(`  ${ns.role.padEnd(6)} ${ns.type.padEnd(13)} ${ns.handle}  — ${ns.displayName}`);
    }
    return 0;
  },
});
