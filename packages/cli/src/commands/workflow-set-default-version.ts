import { defineCommand, parsePositiveIntArg } from '../define-command';
import { printJson, printError } from '../output';

export const workflowSetDefaultVersionCommand = defineCommand({
  name: 'mediforce workflow set-default-version',
  description: 'Set the version an unpinned run of a workflow executes.',
  args: {
    name: {
      type: 'positional',
      required: true,
      description: 'Workflow definition name',
    },
    namespace: { type: 'string', required: true, description: 'Workspace handle' },
    version: { type: 'string', required: true, description: 'Version to make the default' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const version = parsePositiveIntArg(args.version);
    if (version === 'invalid' || version === undefined) {
      printError(output, { error: `Invalid --version: ${String(args.version)}` }, jsonMode);
      return 2;
    }
    const result = await mediforce.workflows.setDefaultVersion({
      name: args.name,
      namespace: args.namespace!,
      version,
    });
    if (jsonMode) {
      printJson(output, result);
    } else {
      output.stdout(`Set ${result.name} default version to v${String(result.version)}`);
    }
    return 0;
  },
});
