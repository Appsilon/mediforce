import { defineCommand } from '../define-command';
import { printJson, printError } from '../output';

export const workflowImportCommand = defineCommand({
  name: 'mediforce workflow import',
  description:
    'Import a workflow definition from a public GitHub repo (one-time copy). The .wd.json file is fetched server-side, validated, and registered as a new WorkflowDefinition.',
  args: {
    repo: {
      type: 'string',
      required: true,
      description: 'GitHub repo URL (e.g. https://github.com/Appsilon/mediforce-workflows)',
    },
    path: {
      type: 'string',
      required: true,
      description: 'Path to the .wd.json file within the repo (e.g. workflow-designer/workflow-designer.wd.json)',
    },
    ref: {
      type: 'string',
      description: 'Branch, tag, or commit SHA to fetch from (default: main)',
    },
    namespace: {
      type: 'string',
      required: true,
      description: 'Namespace to import the workflow into',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce!.workflows.importFromRepo({
      repo: args.repo,
      path: args.path,
      ref: args.ref,
      namespace: args.namespace,
    });
    if (result.success) {
      if (jsonMode) {
        printJson(output, result);
      } else {
        output.stdout(`Imported ${result.name} v${String(result.version)} into namespace: ${args.namespace}`);
      }
      return 0;
    }
    printError(output, { error: 'Import failed' }, jsonMode);
    return 1;
  },
});
