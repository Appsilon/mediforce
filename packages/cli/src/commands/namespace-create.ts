import { defineCommand } from '../define-command.js';
import { printJson, printKv } from '../output.js';

export const namespaceCreateCommand = defineCommand({
  name: 'mediforce namespace create',
  description: 'Create an organization namespace owned by the caller.',
  args: {
    handle: { type: 'string', required: true, description: 'Handle (lowercase, alphanumeric + hyphens)' },
    'display-name': { type: 'string', required: true, description: 'Human-friendly workspace name' },
    bio: { type: 'string', description: 'Optional short description' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const input = {
      handle: args.handle,
      displayName: args['display-name'],
      ...(args.bio !== undefined ? { bio: args.bio } : {}),
    };
    const result = await mediforce.namespaces.create(input);

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }

    output.stdout(`Created namespace ${result.namespace.handle}`);
    printKv(output, [
      ['type', result.namespace.type],
      ['displayName', result.namespace.displayName],
      ['createdAt', result.namespace.createdAt],
      ['bio', result.namespace.bio ?? undefined],
    ]);
    return 0;
  },
});
