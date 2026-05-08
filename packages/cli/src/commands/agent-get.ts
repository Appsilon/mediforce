import { parseArgs } from 'node:util';
import { Mediforce, ApiError } from '@mediforce/platform-api/client';
import { resolveConfig } from '../config.js';
import { printJson, printError, type OutputSink } from '../output.js';

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

const HELP = `Usage: mediforce agent get <id> [options]

Fetch an agent definition by ID.

Positional:
  <id>                 Agent definition ID

Optional flags:
  --base-url <url>     API base URL (default: http://localhost:9003)
  --json               Emit JSON instead of human-readable output
  --help, -h           Show this help text
`;

const GET_OPTIONS = {
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export async function agentGetCommand(input: CommandInput): Promise<number> {
  let positionals: string[];
  let flags: {
    'base-url'?: string;
    json?: boolean;
    help?: boolean;
  };
  try {
    const parsed = parseArgs({
      args: input.argv,
      options: GET_OPTIONS,
      strict: true,
      allowPositionals: true,
    });
    positionals = parsed.positionals;
    flags = parsed.values;
  } catch (err) {
    input.output.stderr(`mediforce agent get: ${String(err)}`);
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
    const result = await mediforce.agents.get({ id });
    if (jsonMode) {
      printJson(input.output, result);
      return 0;
    }
    const agent = result.agent;
    input.output.stdout(`Agent ${agent.id}`);
    input.output.stdout(`  name:          ${agent.name}`);
    input.output.stdout(`  kind:          ${agent.kind}`);
    input.output.stdout(`  model:         ${agent.foundationModel}`);
    input.output.stdout(`  description:   ${agent.description}`);
    if (agent.runtimeId !== undefined) {
      input.output.stdout(`  runtimeId:     ${agent.runtimeId}`);
    }
    if (agent.visibility !== undefined) {
      input.output.stdout(`  visibility:    ${agent.visibility}`);
    }
    if (agent.namespace !== undefined) {
      input.output.stdout(`  namespace:     ${agent.namespace}`);
    }
    if (agent.skillFileNames.length > 0) {
      input.output.stdout(`  skills:        ${agent.skillFileNames.join(', ')}`);
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
