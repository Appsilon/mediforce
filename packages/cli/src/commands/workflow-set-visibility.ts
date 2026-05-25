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

const HELP = `Usage: mediforce workflow set-visibility <name> --namespace <ns> --visibility <public|private> [options]

Set the visibility of a workflow definition.

Positional:
  <name>               Workflow definition name

Required flags:
  --namespace <ns>     Namespace that owns the workflow
  --visibility <v>     Visibility level (public | private)

Optional flags:
  --base-url <url>     API base URL (default: http://localhost:9003)
  --json               Emit JSON instead of human-readable output
  --help, -h           Show this help text
`;

const SET_VISIBILITY_OPTIONS = {
  namespace: { type: 'string' },
  visibility: { type: 'string' },
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export async function workflowSetVisibilityCommand(input: CommandInput): Promise<number> {
  let positionals: string[];
  let flags: {
    namespace?: string;
    visibility?: string;
    'base-url'?: string;
    json?: boolean;
    help?: boolean;
  };
  try {
    const parsed = parseArgs({
      args: input.argv,
      options: SET_VISIBILITY_OPTIONS,
      strict: true,
      allowPositionals: true,
    });
    positionals = parsed.positionals;
    flags = parsed.values;
  } catch (err) {
    input.output.stderr(`mediforce workflow set-visibility: ${String(err)}`);
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

  if (typeof flags.namespace !== 'string' || flags.namespace.length === 0) {
    printError(input.output, { error: '--namespace is required' }, jsonMode);
    return 2;
  }
  const namespace = flags.namespace;

  if (flags.visibility !== 'public' && flags.visibility !== 'private') {
    printError(input.output, { error: '--visibility must be "public" or "private"' }, jsonMode);
    return 2;
  }
  const visibility = flags.visibility;

  let config;
  try {
    config = resolveConfig({ flagBaseUrl: flags['base-url'], env: input.env });
  } catch (err) {
    printError(input.output, { error: String(err) }, jsonMode);
    return 2;
  }

  const mediforce = new Mediforce({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  try {
    const result = await mediforce.workflows.setVisibility({ name, namespace, visibility });
    if (jsonMode) {
      printJson(input.output, result);
    } else {
      input.output.stdout(`Set ${result.name} visibility to ${result.visibility}`);
    }
    return 0;
  } catch (err) {
    printError(input.output, formatCliError(err, { baseUrl: config.baseUrl, jsonMode }), jsonMode);
    return 1;
  }
}
