import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const secretListCommand = defineCommand({
  name: 'mediforce secret list',
  description:
    'List secret key names. Values are never shown. Without --workflow, lists workspace-level secrets.',
  args: {
    namespace: { type: 'string', required: true, description: 'Namespace handle' },
    workflow: { type: 'string', description: 'Workflow name (omit for workspace-level secrets)' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.secrets.list({
      namespace: args.namespace,
      ...(args.workflow !== undefined ? { workflow: args.workflow } : {}),
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    const scope = args.workflow !== undefined
      ? `workflow "${args.workflow}" in namespace "${args.namespace}"`
      : `namespace "${args.namespace}"`;
    if (result.keys.length === 0) {
      output.stdout(`No secrets configured for ${scope}.`);
      return 0;
    }
    output.stdout(`Secrets for ${scope} (${String(result.keys.length)}):\n`);
    for (const key of result.keys) {
      output.stdout(`  ${key}`);
    }
    return 0;
  },
});
