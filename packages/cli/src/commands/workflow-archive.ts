import { defineCommand } from '../define-command';
import { printJson, printError } from '../output';

export const workflowArchiveCommand = defineCommand({
  name: 'mediforce workflow archive',
  description: 'Archive or unarchive a workflow definition version (or all versions).',
  args: {
    name: {
      type: 'positional',
      required: true,
      description: 'Workflow definition name',
    },
    namespace: { type: 'string', required: true, description: 'Workspace handle' },
    version: { type: 'string', description: 'Archive a specific version' },
    all: { type: 'boolean', description: 'Archive all versions' },
    unarchive: { type: 'boolean', description: 'Unarchive instead of archive' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const archived = args.unarchive !== true;

    if (args.version !== undefined && args.all === true) {
      printError(
        output,
        { error: 'Flags are mutually exclusive: --version, --all' },
        jsonMode,
      );
      return 2;
    }
    if (args.all !== true && args.version === undefined) {
      printError(output, { error: 'Either --version <n> or --all is required' }, jsonMode);
      return 2;
    }

    const version = args.version !== undefined ? Number(args.version) : undefined;
    if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
      printError(output, { error: `Invalid --version: ${args.version}` }, jsonMode);
      return 2;
    }

    const namespace = args.namespace!;

    const action = archived ? 'Archived' : 'Unarchived';
    if (version !== undefined) {
      const result = await mediforce.workflows.archiveVersion(
        { name: args.name, version, archived },
        { namespace },
      );
      if (jsonMode) printJson(output, result);
      else output.stdout(`${action} ${args.name} v${String(version)}`);
    } else {
      const result = await mediforce.workflows.archiveAll(
        { name: args.name, archived },
        { namespace },
      );
      if (jsonMode) printJson(output, result);
      else output.stdout(`${action} all versions of ${args.name}`);
    }
    return 0;
  },
});
