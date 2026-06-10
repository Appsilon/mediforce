import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const runDownloadCommand = defineCommand({
  name: 'mediforce run download',
  description:
    "Download a run's Output Files. With PATH (the repo-relative key from `run files`) fetches that single file into the output directory; without it downloads every Output File into <dir>/<stepId>/<name>. Existing files are overwritten.",
  args: {
    runId: {
      type: 'positional',
      required: true,
      description: 'Run identifier',
    },
    path: {
      type: 'positional',
      required: false,
      description: 'Repo-relative file path from `run files` (omit to download all)',
    },
    output: {
      type: 'string',
      alias: 'o',
      description: 'Directory to write files into (default: current directory)',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const outDir = resolve(
      typeof args.output === 'string' && args.output.length > 0 ? args.output : '.',
    );
    const requestedPath = typeof args.path === 'string' && args.path.length > 0 ? args.path : null;
    const downloadAll = requestedPath === null;
    const written: string[] = [];

    if (requestedPath === null) {
      const listed = await mediforce.runs.listOutputFiles({ runId: args.runId });
      if (listed.files.length === 0) {
        if (jsonMode) {
          printJson(output, { written });
        } else {
          output.stdout('No output files.');
        }
        return 0;
      }
      for (const file of listed.files) {
        const downloaded = await mediforce.runs.downloadOutputFile({
          runId: args.runId,
          path: file.path,
        });
        // <outDir>/<stepId>/<name> mirrors the run-branch layout and keeps
        // same-named files from different steps from colliding.
        const destination = join(outDir, file.stepId, file.name);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, downloaded.bytes);
        written.push(destination);
      }
    } else {
      const downloaded = await mediforce.runs.downloadOutputFile({
        runId: args.runId,
        path: requestedPath,
      });
      const destination = join(outDir, downloaded.fileName);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, downloaded.bytes);
      written.push(destination);
    }

    if (jsonMode) {
      printJson(output, { written });
      return 0;
    }
    for (const destination of written) {
      output.stdout(destination);
    }
    if (downloadAll) {
      output.stdout(`Downloaded ${String(written.length)} file(s) to ${outDir}`);
    }
    return 0;
  },
});
