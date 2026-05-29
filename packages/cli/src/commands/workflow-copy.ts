import { defineCommand } from '../define-command';
import { printJson, printError } from '../output';

export const workflowCopyCommand = defineCommand({
  name: 'mediforce workflow copy',
  description: 'Copy a workflow definition to another namespace.',
  args: {
    name: {
      type: 'positional',
      required: true,
      description: 'Source workflow name',
    },
    'target-namespace': {
      type: 'string',
      required: true,
      description: 'Target namespace for the copy',
    },
    'new-name': { type: 'string', description: 'Name in target namespace (default: same as source)' },
    version: { type: 'string', description: 'Source version to copy (default: latest)' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const version = args.version !== undefined ? Number(args.version) : undefined;
    if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
      printError(output, { error: '--version must be a positive integer' }, jsonMode);
      return 2;
    }

    const targetNamespace = args['target-namespace'];
    const result = await mediforce.workflows.copy(
      { name: args.name, version, targetName: args['new-name'] },
      { targetNamespace },
    );
    if (jsonMode) {
      printJson(output, result);
    } else {
      output.stdout(
        `Copied ${result.copiedFrom.name} v${result.copiedFrom.version} → ${targetNamespace}/${result.name} v${result.version}`,
      );
    }
    return 0;
  },
});
