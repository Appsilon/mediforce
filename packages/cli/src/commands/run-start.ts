import { parseArgs } from 'node:util';
import { Mediforce, ApiError } from '@mediforce/platform-api/client';
import { resolveConfig } from '../config.js';
import { printJson, printError, type OutputSink } from '../output.js';

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

const HELP = `Usage: mediforce run start --workflow <name> [options]

Fire a manual trigger to start a new run for the named workflow definition.
The server picks the latest registered version unless --version is supplied.

Required flags:
  --workflow <name>      Workflow definition name (e.g. landing-zone-CDISCPILOT01)

Optional flags:
  --version <number>     Pin a specific definition version (default: latest)
  --trigger <name>       Trigger name (default: manual)
  --triggered-by <id>    Identifier recorded as the run's initiator
                         (default: mediforce-cli)
  --base-url <url>       API base URL (default: http://localhost:9003)
  --json                 Emit JSON instead of human-readable output
  --help, -h             Show this help text

After start, follow the run with:
  mediforce run get <runId>
`;

const RUN_START_OPTIONS = {
  workflow: { type: 'string' },
  version: { type: 'string' },
  trigger: { type: 'string' },
  'triggered-by': { type: 'string' },
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export async function runStartCommand(input: CommandInput): Promise<number> {
  let flags: {
    workflow?: string;
    version?: string;
    trigger?: string;
    'triggered-by'?: string;
    'base-url'?: string;
    json?: boolean;
    help?: boolean;
  };
  try {
    const parsed = parseArgs({
      args: input.argv,
      options: RUN_START_OPTIONS,
      strict: true,
      allowPositionals: false,
    });
    flags = parsed.values;
  } catch (err) {
    input.output.stderr(`mediforce run start: ${String(err)}`);
    input.output.stderr('');
    input.output.stderr(HELP);
    return 2;
  }
  const jsonMode = flags.json === true;

  if (flags.help === true) {
    input.output.stdout(HELP);
    return 0;
  }

  if (typeof flags.workflow !== 'string' || flags.workflow.length === 0) {
    printError(input.output, { error: '--workflow is required' }, jsonMode);
    input.output.stderr('');
    input.output.stderr(HELP);
    return 2;
  }

  let definitionVersion: number | undefined;
  if (typeof flags.version === 'string') {
    const parsedVersion = Number.parseInt(flags.version, 10);
    if (!Number.isInteger(parsedVersion) || parsedVersion <= 0) {
      printError(
        input.output,
        { error: `--version must be a positive integer, got '${flags.version}'` },
        jsonMode,
      );
      return 2;
    }
    definitionVersion = parsedVersion;
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
    const result = await mediforce.runs.start({
      definitionName: flags.workflow,
      definitionVersion,
      triggerName: flags.trigger ?? 'manual',
      triggeredBy: flags['triggered-by'] ?? 'mediforce-cli',
    });
    if (jsonMode) {
      printJson(input.output, result);
      return 0;
    }
    input.output.stdout(`Run started`);
    input.output.stdout(`  instanceId: ${result.instanceId}`);
    input.output.stdout(`  status:     ${result.status}`);
    input.output.stdout('');
    input.output.stdout(`Follow with: mediforce run get ${result.instanceId}`);
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
