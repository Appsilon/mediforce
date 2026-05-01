import { parseArgs } from 'node:util';
import { Mediforce, ApiError } from '@mediforce/platform-api/client';
import { resolveConfig } from '../config.js';
import { printJson, printError, type OutputSink } from '../output.js';

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

const HELP = `Usage: mediforce workflow archive <name> [options]

Archive or unarchive a workflow definition version (or all versions).

Positional:
  <name>               Workflow definition name

Required flags (one of):
  --version <n>        Archive a specific version
  --all                Archive all versions

Optional flags:
  --unarchive          Unarchive instead of archive
  --base-url <url>     API base URL (default: http://localhost:9003)
  --json               Emit JSON instead of human-readable output
  --help, -h           Show this help text

Examples:
  mediforce workflow archive my-workflow --version 3
  mediforce workflow archive my-workflow --version 3 --unarchive
  mediforce workflow archive my-workflow --all
`;

const ARCHIVE_OPTIONS = {
  version: { type: 'string' },
  all: { type: 'boolean' },
  unarchive: { type: 'boolean' },
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export async function workflowArchiveCommand(input: CommandInput): Promise<number> {
  let positionals: string[];
  let flags: {
    version?: string;
    all?: boolean;
    unarchive?: boolean;
    'base-url'?: string;
    json?: boolean;
    help?: boolean;
  };
  try {
    const parsed = parseArgs({
      args: input.argv,
      options: ARCHIVE_OPTIONS,
      strict: true,
      allowPositionals: true,
    });
    positionals = parsed.positionals;
    flags = parsed.values;
  } catch (err) {
    input.output.stderr(`mediforce workflow archive: ${String(err)}`);
    input.output.stderr('');
    input.output.stderr(HELP);
    return 2;
  }

  const jsonMode = flags.json === true;

  if (flags.help === true) {
    input.output.stdout(HELP);
    return 0;
  }

  const name = positionals[0];
  if (typeof name !== 'string' || name.length === 0) {
    printError(input.output, { error: '<name> is required' }, jsonMode);
    return 2;
  }

  const archived = flags.unarchive !== true;

  if (flags.all !== true && flags.version === undefined) {
    printError(input.output, { error: 'Either --version <n> or --all is required' }, jsonMode);
    return 2;
  }

  if (flags.all === true && flags.version !== undefined) {
    printError(input.output, { error: '--version and --all are mutually exclusive' }, jsonMode);
    return 2;
  }

  const version = flags.version !== undefined ? Number(flags.version) : undefined;
  if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
    printError(input.output, { error: `Invalid --version: ${flags.version}` }, jsonMode);
    return 2;
  }

  let config;
  try {
    config = resolveConfig({ flagBaseUrl: flags['base-url'], env: input.env });
  } catch (err) {
    printError(input.output, { error: String(err) }, jsonMode);
    return 2;
  }

  const mediforce = new Mediforce({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  const action = archived ? 'Archived' : 'Unarchived';

  try {
    if (version !== undefined) {
      const result = await mediforce.workflows.archiveVersion({
        name,
        version,
        archived,
      });
      if (jsonMode) {
        printJson(input.output, result);
      } else {
        input.output.stdout(`${action} ${name} v${String(version)}`);
      }
    } else {
      const result = await mediforce.workflows.archiveAll({ name, archived });
      if (jsonMode) {
        printJson(input.output, result);
      } else {
        input.output.stdout(`${action} all versions of ${name}`);
      }
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
