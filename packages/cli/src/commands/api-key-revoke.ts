import { parseArgs } from 'node:util';
import { Mediforce, ApiError } from '@mediforce/platform-api/client';
import { resolveConfig } from '../config.js';
import { printJson, printError, type OutputSink } from '../output.js';

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

const HELP = `Usage: mediforce api-key revoke <keyId> [--user <uid>] [options]

Revoke an API key. The key will immediately stop working.

Required positional:
  <keyId>             ID of the API key to revoke

Optional flags:
  --user <uid>        Firebase UID of the key owner (admin mode)
  --base-url <url>    API base URL (default: http://localhost:9003)
  --json              Emit JSON instead of human-readable output
  --help, -h          Show this help text
`;

const OPTIONS = {
  user: { type: 'string' },
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export async function apiKeyRevokeCommand(input: CommandInput): Promise<number> {
  let flags: { user?: string; 'base-url'?: string; json?: boolean; help?: boolean };
  let positionals: string[];
  try {
    const parsed = parseArgs({ args: input.argv, options: OPTIONS, strict: true, allowPositionals: true });
    flags = parsed.values;
    positionals = parsed.positionals;
  } catch (err) {
    input.output.stderr(`mediforce api-key revoke: ${String(err)}`);
    input.output.stderr('');
    input.output.stderr(HELP);
    return 2;
  }

  if (flags.help === true) { input.output.stdout(HELP); return 0; }

  const keyId = positionals[0];
  if (!keyId) {
    printError(input.output, { error: '<keyId> is required' }, false);
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
    await mediforce.apiKeys.revoke({
      keyId,
      ...(flags.user ? { userId: flags.user } : {}),
    });

    if (jsonMode) {
      printJson(input.output, { ok: true, keyId });
      return 0;
    }

    input.output.stdout(`API key ${keyId} revoked.`);
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
