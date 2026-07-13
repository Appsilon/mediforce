import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  RegisterWorkflowInputSchema,
  type RegisterWorkflowInput,
} from '@mediforce/platform-api/contract';
import { parseWorkflowDefinitionForCreation } from '@mediforce/platform-core';
import { defineCommand } from '../define-command';
import { printJson, printError, type OutputSink } from '../output';

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
    // Agent steps configure their container under `agent`; script steps under `script`.
    for (const containerConfig of [step.agent, step.script]) {
      const image = containerConfig?.image;
      const hasBuildSource =
        typeof containerConfig?.repo === 'string' && containerConfig.repo.length > 0
        && typeof containerConfig?.commit === 'string' && containerConfig.commit.length > 0;
      if (typeof image === 'string' && image.length > 0 && !hasBuildSource) images.add(image);
    }
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
      const withVisibilityOverride =
        args.visibility !== undefined && parsedJson !== null && typeof parsedJson === 'object'
          ? { ...(parsedJson as Record<string, unknown>), visibility: args.visibility }
          : parsedJson;
      const result = RegisterWorkflowInputSchema.safeParse(withVisibilityOverride);
      if (!result.success) {
        printError(
          output,
          { error: 'Invalid workflow definition', body: result.error.issues },
          jsonMode,
        );
        return 1;
      }
      body = result.data;
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
      await warnMissingImages(body, output, jsonMode);
      return 0;
    }

    // dry-run path returned above; mediforce is defined on the non-skip path.
    const result = await mediforce!.workflows.register(body, { namespace: args.namespace });
    if (jsonMode) {
      printJson(output, result);
    } else {
      output.stdout(`Registered ${result.name} v${String(result.version)} (namespace: ${args.namespace})`);
      if (result.warnings?.length) {
        output.stderr(`\nWarning: ${String(result.warnings.length)} Docker image(s) not found on platform:`);
        for (const w of result.warnings) output.stderr(`  - ${w.message}`);
      }
    }
    // Server-side warnings are authoritative (platform images); fall back to
    // local `docker image inspect` only when the server didn't check (e.g. local-agent mode).
    if (!result.warnings?.length) {
      await warnMissingImages(body, output, jsonMode);
    }
    return 0;
  },
});
