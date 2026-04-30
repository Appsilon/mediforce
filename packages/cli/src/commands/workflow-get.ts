import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { Mediforce, ApiError } from '@mediforce/platform-api/client';
import { resolveConfig } from '../config.js';
import { printJson, printError, type OutputSink } from '../output.js';

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

const HELP = `Usage: mediforce workflow get <name> [options]

Fetch a workflow definition by name. Outputs the full definition JSON,
suitable for editing and re-registering with \`workflow register\`.

Positional:
  <name>               Workflow definition name

Optional flags:
  --version <n>        Specific version (default: latest)
  --output <path>      Write to file instead of stdout
  --template           Strip version/createdAt/namespace for re-registration
  --base-url <url>     API base URL (default: http://localhost:9003)
  --json               Emit JSON (default for this command)
  --help, -h           Show this help text
`;

const GET_OPTIONS = {
  version: { type: 'string' },
  output: { type: 'string' },
  template: { type: 'boolean' },
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export async function workflowGetCommand(input: CommandInput): Promise<number> {
  let positionals: string[];
  let flags: {
    version?: string;
    output?: string;
    template?: boolean;
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
    input.output.stderr(`mediforce workflow get: ${String(err)}`);
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

  const version =
    flags.version !== undefined ? Number(flags.version) : undefined;
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
  try {
    const result = await mediforce.workflows.get({ name, version });
    let output: unknown = result.definition;

    if (flags.template === true) {
      const { version: _v, createdAt: _c, namespace: _n, ...template } = result.definition;
      output = template;
    }

    const json = JSON.stringify(output, null, 2);

    if (typeof flags.output === 'string' && flags.output.length > 0) {
      await writeFile(flags.output, json + '\n', 'utf-8');
      input.output.stdout(`Written to ${flags.output}`);
    } else {
      if (!jsonMode) {
        const def = result.definition;
        const stepCount = Array.isArray(def.steps) ? def.steps.length : 0;
        const transCount = Array.isArray(def.transitions) ? def.transitions.length : 0;
        const triggerCount = Array.isArray(def.triggers) ? def.triggers.length : 0;
        input.output.stdout(
          `${def.name} v${String(def.version)} (namespace: ${def.namespace}, ${String(stepCount)} steps, ${String(transCount)} transitions, ${String(triggerCount)} triggers)`,
        );
      }
      input.output.stdout(json);
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
