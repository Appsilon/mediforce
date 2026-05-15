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

const HELP = `Usage: mediforce system credits --namespace <ns> [options]

Show OpenRouter credit balance for a workspace.
Reads the OPENROUTER_API_KEY from workspace secrets and queries OpenRouter.

Required flags:
  --namespace <ns>    Namespace handle

Optional flags:
  --base-url <url>    API base URL (default: http://localhost:9003)
  --json              Emit JSON instead of human-readable output
  --help, -h          Show this help text
`;

const OPTIONS = {
  namespace: { type: 'string' },
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export async function systemCreditsCommand(input: CommandInput): Promise<number> {
  let flags: {
    namespace?: string;
    'base-url'?: string;
    json?: boolean;
    help?: boolean;
  };
  try {
    const parsed = parseArgs({
      args: input.argv,
      options: OPTIONS,
      strict: true,
      allowPositionals: false,
    });
    flags = parsed.values;
  } catch (err) {
    input.output.stderr(`mediforce system credits: ${String(err)}`);
    input.output.stderr('');
    input.output.stderr(HELP);
    return 2;
  }

  if (flags.help === true) {
    input.output.stdout(HELP);
    return 0;
  }

  if (!flags.namespace) {
    printError(input.output, { error: '--namespace is required' }, false);
    input.output.stderr('');
    input.output.stderr(HELP);
    return 2;
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
    const data = await mediforce.system.credits({ namespace: flags.namespace });

    if (jsonMode) {
      printJson(input.output, data);
      return 0;
    }

    if (!data.available) {
      input.output.stderr(data.error ?? 'OpenRouter credits not available.');
      return 1;
    }

    input.output.stdout(`OpenRouter credits for namespace "${flags.namespace}":\n`);
    input.output.stdout(`  Remaining:  $${data.remaining.toFixed(2)}`);
    input.output.stdout(`  Used:       $${data.usage.toFixed(2)}`);
    input.output.stdout(`  Limit:      $${data.limit.toFixed(2)}`);
    return 0;
  } catch (err) {
    printError(input.output, formatCliError(err, { baseUrl: config.baseUrl, jsonMode }), jsonMode);
    return 1;
  }
}
