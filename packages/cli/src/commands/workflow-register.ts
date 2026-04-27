import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { Mediforce, ApiError } from '@mediforce/platform-api/client';
import {
  RegisterWorkflowInputSchema,
  type RegisterWorkflowInput,
} from '@mediforce/platform-api/contract';
import { parseWorkflowDefinitionForCreation } from '@mediforce/platform-core';
import { resolveConfig } from '../config.js';
import { printJson, printError, type OutputSink } from '../output.js';

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

const HELP = `Usage: mediforce workflow register --file <path> --namespace <ns> [options]

Register a workflow definition from a JSON file. The file should contain a
WorkflowDefinition without \`version\`, \`createdAt\`, or \`namespace\` — those
are filled in server-side.

Required flags:
  --file <path>        Path to the workflow definition JSON file
  --namespace <ns>     Namespace that owns the registered workflow

Optional flags:
  --base-url <url>     API base URL (default: http://localhost:9003)
  --dry-run            Validate the file locally without calling the API
  --json               Emit JSON instead of human-readable output
  --help, -h           Show this help text
`;

const REGISTER_OPTIONS = {
  file: { type: 'string' },
  namespace: { type: 'string' },
  'base-url': { type: 'string' },
  'dry-run': { type: 'boolean' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export async function workflowRegisterCommand(input: CommandInput): Promise<number> {
  let flags: {
    file?: string;
    namespace?: string;
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
    return 0;
  } catch (err) {
    if (err instanceof ApiError) {
      printError(
        input.output,
        { error: err.message, status: err.status, body: err.body },
        jsonMode,
      );
    } else {
      printError(input.output, { error: String(err) }, jsonMode);
    }
    return 1;
  }
}
