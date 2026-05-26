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

async function warnMissingImages(body: RegisterWorkflowInput, output: OutputSink, jsonMode: boolean): Promise<void> {
  const images = new Set<string>();
  for (const step of body.steps) {
    const agent = (step as { agent?: { image?: string; repo?: string; commit?: string } }).agent;
    const image = agent?.image;
    const hasBuildSource = typeof agent?.repo === 'string' && agent.repo.length > 0
      && typeof agent?.commit === 'string' && agent.commit.length > 0;
    if (typeof image === 'string' && image.length > 0 && !hasBuildSource) images.add(image);
  }
  if (images.size === 0) return;

  const missing: string[] = [];
  for (const image of images) {
    if (!await checkImageExists(image)) missing.push(image);
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

const HELP = `Usage: mediforce workflow register --file <path> --namespace <ns> [options]

Register a workflow definition from a JSON file. The file should contain a
WorkflowDefinition without \`version\`, \`createdAt\`, or \`namespace\` — those
are filled in server-side.

Required flags:
  --file <path>        Path to the workflow definition JSON file
  --namespace <ns>     Namespace that owns the registered workflow

Optional flags:
  --visibility <v>     Override visibility (public | private)
  --base-url <url>     API base URL (default: http://localhost:9003)
  --dry-run            Validate the file locally without calling the API
  --json               Emit JSON instead of human-readable output
  --help, -h           Show this help text
`;

export const workflowRegisterCommand = defineCommand({
  name: 'workflow register',
  help: HELP,
  options: {
    file: { type: 'string' },
    namespace: { type: 'string' },
    visibility: { type: 'string' },
    'base-url': { type: 'string' },
    'dry-run': { type: 'boolean' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } as const,
  skipClientWhen: (flags) => flags['dry-run'] === true,
  handler: async ({ flags, mediforce, output, jsonMode }) => {
    if (typeof flags.file !== 'string' || flags.file.length === 0) {
      printError(output, { error: '--file is required' }, jsonMode);
      return 2;
    }
    if (typeof flags.namespace !== 'string' || flags.namespace.length === 0) {
      printError(output, { error: '--namespace is required' }, jsonMode);
      return 2;
    }

    if (flags.visibility !== undefined && flags.visibility !== 'public' && flags.visibility !== 'private') {
      printError(output, { error: '--visibility must be "public" or "private"' }, jsonMode);
      return 2;
    }

    let raw: string;
    try {
      raw = await readFile(flags.file, 'utf-8');
    } catch (err) {
      printError(
        output,
        { error: `Failed to read file: ${flags.file} — ${String(err)}` },
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
          {
            error: 'Invalid workflow definition',
            body: result.error.issues,
          },
          jsonMode,
        );
        return 1;
      }
      body = result.data;
      if (flags.visibility !== undefined) {
        body = { ...body, visibility: flags.visibility as 'public' | 'private' };
      }
    } catch (err) {
      printError(output, { error: `Invalid JSON: ${String(err)}` }, jsonMode);
      return 1;
    }

    if (flags['dry-run'] === true) {
      // Mirror the server-side parse exactly so dry-run can never pass while a
      // real POST would fail. The server applies `parseWorkflowDefinitionForCreation`
      // (= WorkflowDefinitionBase.omit({version, createdAt}).superRefine(validateInputForNextRun))
      // after injecting the namespace from the query string. We do the same here
      // and emit the same `{ error: 'Validation failed', issues }` shape.
      const serverParse = parseWorkflowDefinitionForCreation({
        ...body,
        namespace: flags.namespace,
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
        namespace: flags.namespace,
        stepCount: body.steps.length,
        transitionCount: body.transitions.length,
        triggerCount: body.triggers.length,
      };
      if (jsonMode) {
        printJson(output, summary);
      } else {
        output.stdout(
          `[dry-run] OK — ${body.name} (namespace: ${flags.namespace}, ${String(body.steps.length)} steps, ${String(body.transitions.length)} transitions, ${String(body.triggers.length)} triggers)`,
        );
      }
      return 0;
    }

    const result = await mediforce!.workflows.register(body, {
      namespace: flags.namespace,
    });
    if (jsonMode) {
      printJson(output, result);
    } else {
      output.stdout(
        `Registered ${result.name} v${String(result.version)} (namespace: ${flags.namespace})`,
      );
    }
    await warnMissingImages(body, output, jsonMode);
    return 0;
  },
});
