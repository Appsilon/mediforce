import { parseArgs } from 'node:util';
import { Mediforce, ApiError } from '@mediforce/platform-api/client';
import { resolveConfig } from '../config.js';
import { printJson, printError, type OutputSink } from '../output.js';

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

const HELP = `Usage: mediforce agent delete <id> [options]

Delete an agent definition by ID.

Positional:
  <id>                 Agent definition ID

Required flags:
  --force              Confirm deletion (required)

Optional flags:
  --base-url <url>     API base URL (default: http://localhost:9003)
  --json               Emit JSON instead of human-readable output
  --help, -h           Show this help text
`;

const OPTIONS = {
  force: { type: 'boolean' },
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export async function agentDeleteCommand(input: CommandInput): Promise<number> {
  let positionals: string[];
  let flags: {
    force?: boolean;
    'base-url'?: string;
    json?: boolean;
    help?: boolean;
  };
  try {
    const parsed = parseArgs({
      args: input.argv,
      options: OPTIONS,
      strict: true,
      allowPositionals: true,
    });
    positionals = parsed.positionals;
    flags = parsed.values;
  } catch (err) {
    input.output.stderr(`mediforce agent delete: ${String(err)}`);
    input.output.stderr('');
    input.output.stderr(HELP);
    return 2;
  }

  const jsonMode = flags.json === true;

  if (flags.help === true) {
    input.output.stdout(HELP);
    return 0;
  }

  const id = positionals[0];
  if (typeof id !== 'string' || id.length === 0) {
    printError(input.output, { error: '<id> is required' }, jsonMode);
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
    if (flags.force !== true) {
      const { agent } = await mediforce.agents.get({ id });
      input.output.stderr(`About to delete agent ${agent.id}:`);
      input.output.stderr(`  name:    ${agent.name}`);
      input.output.stderr(`  model:   ${agent.foundationModel}`);
      if (agent.namespace !== undefined) {
        input.output.stderr(`  ns:      ${agent.namespace}`);
      }
      input.output.stderr('');
      printError(input.output, { error: 'Pass --force to confirm deletion' }, jsonMode);
      return 1;
    }
    const result = await mediforce.agents.delete({ id });
    if (jsonMode) {
      printJson(input.output, result);
      return 0;
    }
    input.output.stdout(`Deleted agent ${id}`);
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
