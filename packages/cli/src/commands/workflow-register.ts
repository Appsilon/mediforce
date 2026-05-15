import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Mediforce } from '@mediforce/platform-api/client';
import {
  RegisterWorkflowInputSchema,
  type RegisterWorkflowInput,
} from '@mediforce/platform-api/contract';
import { parseWorkflowDefinitionForCreation } from '@mediforce/platform-core';
import { resolveConfig } from '../config.js';
import { printJson, printError, type OutputSink } from '../output.js';
import { formatCliError } from '../errors.js';

const execFileAsync = promisify(execFile);

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

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

const REGISTER_OPTIONS = {
  file: { type: 'string' },
  namespace: { type: 'string' },
  visibility: { type: 'string' },
  'base-url': { type: 'string' },
  'dry-run': { type: 'boolean' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export async function workflowRegisterCommand(input: CommandInput): Promise<number> {
  let flags: {
    file?: string;
    namespace?: string;
    visibility?: string;
    'base-url'?: string;
    'dry-run'?: boolean;
    json?: boolean;
    help?: boolean;
  };
  try {
    const parsed = parseArgs({
      args: input.argv,
      options: REGISTER_OPTIONS,
      strict: true,
      allowPositionals: false,
    });
    flags = parsed.values;
  } catch (err) {
    input.output.stderr(`mediforce workflow register: ${String(err)}`);
    input.output.stderr('');
    input.output.stderr(HELP);
    return 2;
  }
  const jsonMode = flags.json === true;

  if (flags.help === true) {
    input.output.stdout(HELP);
    return 0;
  }

  if (typeof flags.file !== 'string' || flags.file.length === 0) {
    printError(input.output, { error: '--file is required' }, jsonMode);
    return 2;
  }
  if (typeof flags.namespace !== 'string' || flags.namespace.length === 0) {
    printError(input.output, { error: '--namespace is required' }, jsonMode);
    return 2;
  }

  if (flags.visibility !== undefined && flags.visibility !== 'public' && flags.visibility !== 'private') {
    printError(input.output, { error: '--visibility must be "public" or "private"' }, jsonMode);
    return 2;
  }

  let raw: string;
  try {
    raw = await readFile(flags.file, 'utf-8');
  } catch (err) {
    printError(
      input.output,
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
        input.output,
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
    printError(input.output, { error: `Invalid JSON: ${String(err)}` }, jsonMode);
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
        input.output,
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
      printJson(input.output, summary);
    } else {
      input.output.stdout(
        `[dry-run] OK — ${body.name} (namespace: ${flags.namespace}, ${String(body.steps.length)} steps, ${String(body.transitions.length)} transitions, ${String(body.triggers.length)} triggers)`,
      );
    }
    return 0;
  }

  let config;
  try {
    config = resolveConfig({ flagBaseUrl: flags['base-url'], env: input.env });
  } catch (err) {
    printError(input.output, { error: String(err) }, jsonMode);
    return 2;
  }

  const mediforce = new Mediforce({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  try {
    const result = await mediforce.workflows.register(body, {
      namespace: flags.namespace,
    });
    if (jsonMode) {
      printJson(input.output, result);
    } else {
      input.output.stdout(
        `Registered ${result.name} v${String(result.version)} (namespace: ${flags.namespace})`,
      );
    }
    await warnMissingImages(body, input.output, jsonMode);
    return 0;
  } catch (err) {
    printError(input.output, formatCliError(err, { baseUrl: config.baseUrl, jsonMode }), jsonMode);
    return 1;
  }
}
