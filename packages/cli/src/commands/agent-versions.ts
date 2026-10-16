import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const agentVersionsCommand = defineCommand({
  name: 'mediforce agent versions',
  description: 'List an agent\'s versions, newest first: each configuration it was saved or evaluated with (ADR-0029).',
  args: {
    id: {
      type: 'positional',
      required: true,
      description: 'Agent definition ID',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.agents.listVersions({ id: args.id });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.versions.length === 0) output.stdout('No versions recorded.');
    for (const version of result.versions) {
      const current = version.version === result.current ? '  (current)' : '';
      output.stdout(`v${version.version}  ${version.createdAt}  ${version.hash.slice(0, 12)}  ${version.config.foundationModel}${current}`);
    }
    if (result.versions.length > 0 && result.current === null) {
      output.stdout('The agent changed since its newest version; its next save or Eval Run records a new one.');
    }
    return 0;
  },
});
