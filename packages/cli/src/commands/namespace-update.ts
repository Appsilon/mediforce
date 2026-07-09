import { defineCommand } from '../define-command';
import { printJson, printKv } from '../output';

export const namespaceUpdateCommand = defineCommand({
  name: 'mediforce namespace update',
  description: 'Edit workspace metadata (display name, bio, icon).',
  args: {
    handle: { type: 'string', required: true, description: 'Workspace handle' },
    'display-name': { type: 'string', description: 'New display name' },
    bio: { type: 'string', description: 'New bio (pass empty string to clear)' },
    icon: { type: 'string', description: 'New icon key' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const input: Parameters<typeof mediforce.namespaces.update>[0] = { handle: args.handle };
    if (args['display-name'] !== undefined) input.displayName = args['display-name'];
    if (args.icon !== undefined) input.icon = args.icon;
    if (args.bio !== undefined) input.bio = args.bio;

    const result = await mediforce.namespaces.update(input);

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }

    output.stdout(`Updated namespace ${result.namespace.handle}`);
    printKv(output, [
      ['displayName', result.namespace.displayName],
      ['bio', result.namespace.bio ?? undefined],
      ['icon', result.namespace.icon ?? undefined],
    ]);
    return 0;
  },
});
