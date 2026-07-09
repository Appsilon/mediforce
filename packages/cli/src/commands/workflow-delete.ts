import { defineCommand } from '../define-command';
import { printJson, printError } from '../output';

export const workflowDeleteCommand = defineCommand({
  name: 'mediforce workflow delete',
  description:
    'Soft-delete a workflow definition + cascade-delete all associated runs and human tasks. The server checks the current run count matches before deleting.',
  args: {
    name: {
      type: 'positional',
      required: true,
      description: 'Workflow definition name',
    },
    namespace: { type: 'string', required: true, description: 'Workspace handle' },
    'expected-run-count': {
      type: 'string',
      description: 'Expected run count (default: probe via run-count)',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const name = args.name;
    const namespace = args.namespace!;

    let expectedRunCount: number;
    if (args['expected-run-count'] !== undefined) {
      expectedRunCount = Number(args['expected-run-count']);
      if (!Number.isFinite(expectedRunCount) || expectedRunCount < 0) {
        printError(output, { error: 'Invalid --expected-run-count' }, jsonMode);
        return 2;
      }
    } else {
      const { count } = await mediforce.workflows.getRunCount({ name, namespace });
      expectedRunCount = count;
    }

    const result = await mediforce.workflows.delete({ name, namespace, expectedRunCount });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Workflow '${name}' deleted (cascaded ${String(result.deletedRuns)} runs)`);
    return 0;
  },
});
