import { formatBytes } from '@mediforce/platform-core';
import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const runFilesCommand = defineCommand({
  name: 'mediforce run files',
  description:
    "List a run's Output Files (artifacts agent steps committed under `.mediforce/output/<stepId>/`). Each line shows the repo-relative path — the download key for `run download`.",
  args: {
    runId: {
      type: 'positional',
      required: true,
      description: 'Run identifier',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.runs.listOutputFiles({ runId: args.runId });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.files.length === 0) {
      output.stdout('No output files.');
      return 0;
    }
    const filesByStep = new Map<string, typeof result.files>();
    for (const file of result.files) {
      const group = filesByStep.get(file.stepId);
      if (group !== undefined) {
        group.push(file);
      } else {
        filesByStep.set(file.stepId, [file]);
      }
    }
    for (const [stepId, files] of filesByStep) {
      output.stdout(`${stepId}:`);
      for (const file of files) {
        output.stdout(`  ${file.name}  ${formatBytes(file.size)}  ${file.path}`);
      }
    }
    return 0;
  },
});
