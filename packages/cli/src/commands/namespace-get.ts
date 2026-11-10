import { defineCommand } from '../define-command';
import { printJson, printKv } from '../output';

export const namespaceGetCommand = defineCommand({
  name: 'mediforce namespace get',
  description: 'Fetch a namespace’s metadata + member list.',
  args: {
    handle: { type: 'positional', required: true, description: 'Namespace handle' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.namespaces.get({ handle: args.handle });

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }

    output.stdout(`Namespace ${result.namespace.handle}`);
    printKv(output, [
      ['type', result.namespace.type],
      ['displayName', result.namespace.displayName],
      ['createdAt', result.namespace.createdAt],
      ['bio', result.namespace.bio ?? undefined],
      ['linkedUserId', result.namespace.linkedUserId ?? undefined],
      ['outputBudget', result.namespace.outputBudget ?? 'default'],
      ['defaultModel', result.namespace.defaultModel ?? 'platform'],
    ]);
    output.stdout('');
    output.stdout(`Members (${result.members.length}):`);
    for (const member of result.members) {
      const name = member.displayName !== undefined ? ` (${member.displayName})` : '';
      const budget = member.outputBudget !== undefined ? ` [output budget: ${member.outputBudget}]` : '';
      const model = member.defaultModel !== undefined ? ` [default model: ${member.defaultModel}]` : '';
      output.stdout(`  ${member.role.padEnd(6)} ${member.uid}${name}${budget}${model}`);
    }
    return 0;
  },
});
