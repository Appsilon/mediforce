import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  RegisterWorkflowInputSchema,
  type RegisterWorkflowInput,
} from '@mediforce/platform-api/contract';
import { parseWorkflowDefinitionForCreation } from '@mediforce/platform-core';
import { defineCommand } from '../define-command.js';
import { printJson, printError, type OutputSink } from '../output.js';

const execFileAsync = promisify(execFile);

async function checkImageExists(image: string): Promise<boolean> {
  try {
    await execFileAsync('docker', ['image', 'inspect', image]);
    return true;
  } catch {
    return false;
  }
}

async function warnMissingImages(
  body: RegisterWorkflowInput,
  output: OutputSink,
  jsonMode: boolean,
): Promise<void> {
  const images = new Set<string>();
  for (const step of body.steps) {
    const agent = (step as { agent?: { image?: string; repo?: string; commit?: string } }).agent;
    const image = agent?.image;
    const hasBuildSource =
      typeof agent?.repo === 'string' && agent.repo.length > 0
      && typeof agent?.commit === 'string' && agent.commit.length > 0;
    if (typeof image === 'string' && image.length > 0 && !hasBuildSource) images.add(image);
  }
  if (images.size === 0) return;

  const missing: string[] = [];
  for (const image of images) {
    if (!(await checkImageExists(image))) missing.push(image);
  }
  if (missing.length === 0) return;

  if (jsonMode) {
    output.stderr(JSON.stringify({ warning: 'Missing Docker images', images: missing }));
  } else {
    output.stderr(`\nWarning: ${String(missing.length)} Docker image(s) not found locally:`);
    for (const img of missing) output.stderr(`  - ${img}`);
    output.stderr('These steps will fail at runtime unless images are built or pulled.');
  }
}

export const workflowRegisterCommand = defineCommand({
  name: 'mediforce workflow register',
  description:
    'Register a workflow definition from a JSON file. The file should contain a WorkflowDefinition without `version`, `createdAt`, or `namespace` — those are filled in server-side.',
  args: {
    file: { type: 'string', required: true, description: 'Path to the workflow definition JSON file' },
    namespace: { type: 'string', required: true, description: 'Namespace that owns the registered workflow' },
    visibility: { type: 'enum', options: ['public', 'private'], description: 'Override visibility' },
    'dry-run': { type: 'boolean', description: 'Validate the file locally without calling the API' },
  },
  skipClientWhen: (args) => args['dry-run'] === true,
  async run({ args, output, mediforce, jsonMode }) {
    let raw: string;
    try {
      raw = await readFile(args.file, 'utf-8');
    } catch (err) {
      printError(
        output,
        { error: `Failed to read file: ${args.file} — ${String(err)}` },
        jsonMode,
      );
      return 1;
    }

    let body: RegisterWorkflowInput;
    try {
      const parsedJson: unknown = JSON.parse(raw);
      const result = RegisterWorkflowInputSchema.safeParse(parsedJson);
      if (!result.success) {
        printError(
          output,
          { error: 'Invalid workflow definition', body: result.error.issues },
          jsonMode,
        );
        return 1;
      }
      body = result.data;
      if (args.visibility !== undefined) {
        body = { ...body, visibility: args.visibility as 'public' | 'private' };
      }
    } catch (err) {
      printError(output, { error: `Invalid JSON: ${String(err)}` }, jsonMode);
      return 1;
    }

    if (args['dry-run'] === true) {
      const serverParse = parseWorkflowDefinitionForCreation({
        ...body,
        namespace: args.namespace,
      });
      if (!serverParse.success) {
        printError(
          output,
          { error: 'Validation failed', body: serverParse.error.issues },
          jsonMode,
        );
        return 1;
      }
      const summary = {
        success: true,
        dryRun: true,
        name: body.name,
        namespace: args.namespace,
        stepCount: body.steps.length,
        transitionCount: body.transitions.length,
        triggerCount: body.triggers.length,
      };
      if (jsonMode) {
        printJson(output, summary);
      } else {
        output.stdout(
          `[dry-run] OK — ${body.name} (namespace: ${args.namespace}, ${String(body.steps.length)} steps, ${String(body.transitions.length)} transitions, ${String(body.triggers.length)} triggers)`,
        );
      }
      return 0;
    }

    // dry-run path returned above; mediforce is defined on the non-skip path.
    const result = await mediforce!.workflows.register(body, { namespace: args.namespace });
    if (jsonMode) {
      printJson(output, result);
    } else {
      output.stdout(`Registered ${result.name} v${String(result.version)} (namespace: ${args.namespace})`);
    }
    await warnMissingImages(body, output, jsonMode);
    return 0;
  },
});
