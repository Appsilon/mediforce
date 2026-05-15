import { parseArgs } from 'node:util';
import { Mediforce } from '@mediforce/platform-api/client';
import { resolveConfig } from '../config.js';
import { printJson, printError, type OutputSink } from '../output.js';
import { formatCliError } from '../errors.js';

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

const HELP = `Usage: mediforce workflow copy <name> --target-namespace <ns> [options]

Copy a workflow definition to another namespace.

Positional:
  <name>                    Source workflow name

Required flags:
  --target-namespace <ns>   Target namespace for the copy

Optional flags:
  --name <new-name>         Name in target namespace (default: same as source)
  --version <n>             Source version to copy (default: latest)
  --base-url <url>          API base URL (default: http://localhost:9003)
  --json                    Emit JSON instead of human-readable output
  --help, -h                Show this help text
`;

const COPY_OPTIONS = {
  'target-namespace': { type: 'string' },
  name: { type: 'string' },
  version: { type: 'string' },
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export async function workflowCopyCommand(input: CommandInput): Promise<number> {
  let positionals: string[];
  let flags: {
    'target-namespace'?: string;
    name?: string;
    version?: string;
    'base-url'?: string;
    json?: boolean;
    help?: boolean;
  };
  try {
    const parsed = parseArgs({
      args: input.argv,
      options: COPY_OPTIONS,
      strict: true,
      allowPositionals: true,
    });
    positionals = parsed.positionals;
    flags = parsed.values;
  } catch (err) {
    input.output.stderr(`mediforce workflow copy: ${String(err)}`);
    input.output.stderr('');
    input.output.stderr(HELP);
    return 2;
  }

  const jsonMode = flags.json === true;

  if (flags.help === true) {
    input.output.stdout(HELP);
    return 0;
  }

  const sourceName = positionals[0];
  if (typeof sourceName !== 'string' || sourceName.length === 0) {
    printError(input.output, { error: '<name> is required' }, jsonMode);
    return 2;
  }

  const targetNamespace = flags['target-namespace'];
  if (typeof targetNamespace !== 'string' || targetNamespace.length === 0) {
    printError(input.output, { error: '--target-namespace is required' }, jsonMode);
    return 2;
  }

  const version = flags.version !== undefined ? Number(flags.version) : undefined;
  if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
    printError(input.output, { error: '--version must be a positive integer' }, jsonMode);
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
  try {
    const result = await mediforce.workflows.copy(
      { name: sourceName, version, targetName: flags.name },
      { targetNamespace },
    );
    if (jsonMode) {
      printJson(input.output, result);
    } else {
      input.output.stdout(
        `Copied ${result.copiedFrom.name} v${result.copiedFrom.version} → ${targetNamespace}/${result.name} v${result.version}`,
      );
    }
    return 0;
  } catch (err) {
    printError(input.output, formatCliError(err, { baseUrl: config.baseUrl, jsonMode }), jsonMode);
    return 1;
  }
}
