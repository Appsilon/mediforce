import { parseArgs } from 'node:util';
import { Mediforce, ApiError } from '@mediforce/platform-api/client';
import { resolveConfig } from '../config.js';
import { printJson, printError, type OutputSink } from '../output.js';

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

const HELP = `Usage: mediforce whoami [options]

Show the identity and namespace access for the current API key.

Optional flags:
  --base-url <url>    API base URL (default: http://localhost:9003)
  --json              Emit JSON instead of human-readable output
  --help, -h          Show this help text
`;

const OPTIONS = {
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export async function whoamiCommand(input: CommandInput): Promise<number> {
  let flags: { 'base-url'?: string; json?: boolean; help?: boolean };
  try {
    const parsed = parseArgs({ args: input.argv, options: OPTIONS, strict: true, allowPositionals: false });
    flags = parsed.values;
  } catch (err) {
    input.output.stderr(`mediforce whoami: ${String(err)}`);
    input.output.stderr('');
    input.output.stderr(HELP);
    return 2;
  }

  if (flags.help === true) {
    input.output.stdout(HELP);
    return 0;
  }

  const jsonMode = flags.json === true;

  let config;
  try {
    config = resolveConfig({ flagBaseUrl: flags['base-url'], env: input.env });
  } catch (err) {
    printError(input.output, { error: String(err) }, jsonMode);
    return 2;
  }

  const mediforce = new Mediforce({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  try {
    const data = await mediforce.me.whoami();

    if (jsonMode) {
      printJson(input.output, data);
      return 0;
    }

    if (data.kind === 'apiKey') {
      input.output.stdout('Identity:    global API key (unrestricted)');
      input.output.stdout('Namespaces:  all (admin access)');
    } else {
      input.output.stdout(`Identity:    user ${data.uid}`);
      input.output.stdout(`Namespaces:  ${data.namespaces.length > 0 ? data.namespaces.join(', ') : '(none)'}`);
    }
    return 0;
  } catch (err) {
    if (err instanceof ApiError) {
      printError(input.output, { error: err.message, status: err.status, body: err.body }, jsonMode);
    } else {
      printError(input.output, { error: err instanceof Error ? err.message : String(err) }, jsonMode);
    }
    return 1;
  }
}
