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

const HELP = `Usage: mediforce model sync [options]

Sync model registry from OpenRouter API.

Optional flags:
  --base-url <url>     API base URL (default: http://localhost:9003)
  --json               Emit JSON instead of human-readable output
  --help, -h           Show this help text
`;

const SYNC_OPTIONS = {
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export async function modelSyncCommand(input: CommandInput): Promise<number> {
  let flags: { 'base-url'?: string; json?: boolean; help?: boolean };
  try {
    const parsed = parseArgs({
      args: input.argv,
      options: SYNC_OPTIONS,
      strict: true,
      allowPositionals: false,
    });
    flags = parsed.values;
  } catch (err) {
    input.output.stderr(`mediforce model sync: ${String(err)}`);
    input.output.stderr('');
    input.output.stderr(HELP);
    return 2;
  }
  const jsonMode = flags.json === true;

  if (flags.help === true) {
    input.output.stdout(HELP);
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
    input.output.stdout('Syncing models from OpenRouter...');
    const result = await mediforce.models.sync();
    if (jsonMode) {
      printJson(input.output, result);
      return 0;
    }
    input.output.stdout(`Synced ${String(result.synced)} models (${String(result.total)} total from OpenRouter)`);
    input.output.stdout(`Last synced: ${result.lastSyncedAt}`);
    return 0;
  } catch (err) {
    printError(input.output, formatCliError(err, { baseUrl: config.baseUrl, jsonMode }), jsonMode);
    return 1;
  }
}
