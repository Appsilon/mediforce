import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const workflowListCommand = defineCommand({
  name: 'mediforce workflow list',
  description: 'List every registered workflow definition (latest version per name).',
  args: {},
  async run({ output, mediforce, jsonMode }) {
    const result = await mediforce.workflows.list();
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.definitions.length === 0) {
      output.stdout('No workflow definitions registered.');
      return 0;
    }
    output.stdout(`Found ${String(result.definitions.length)} workflow(s):`);
    for (const group of result.definitions) {
      const defaultLabel = group.defaultVersion === null ? 'no default' : `default: v${String(group.defaultVersion)}`;
      const visibility = group.definition?.visibility ?? 'private';
      output.stdout(`  ${group.name}  latest: v${String(group.latestVersion)}  (${defaultLabel})  [${visibility}]`);
    }
    return 0;
  },
});
