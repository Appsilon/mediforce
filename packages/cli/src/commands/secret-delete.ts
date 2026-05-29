import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const secretDeleteCommand = defineCommand({
  name: 'mediforce secret delete',
  description:
    'Delete a single secret. Without --workflow, deletes a workspace-level secret.',
  args: {
    namespace: { type: 'string', required: true, description: 'Namespace handle' },
    key: { type: 'string', required: true, description: 'Secret key name to delete' },
    workflow: { type: 'string', description: 'Workflow name (omit for workspace-level secret)' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    await mediforce.secrets.delete({
      namespace: args.namespace,
      ...(args.workflow !== undefined ? { workflow: args.workflow } : {}),
      key: args.key,
    });
    if (jsonMode) {
      printJson(output, { ok: true });
    } else {
      const scope = args.workflow !== undefined
        ? `workflow "${args.workflow}" in namespace "${args.namespace}"`
        : `namespace "${args.namespace}"`;
      output.stdout(`Secret "${args.key}" deleted from ${scope}.`);
    }
    return 0;
  },
});
