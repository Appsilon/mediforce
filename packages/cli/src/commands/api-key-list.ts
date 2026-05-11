import { parseArgs } from 'node:util';
import { Mediforce, ApiError } from '@mediforce/platform-api/client';
import { resolveConfig } from '../config.js';
import { printJson, printError, type OutputSink } from '../output.js';

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

const HELP = `Usage: mediforce api-key list [--user <uid>] [options]

List API keys for the current user, or for a specified user (admin mode).

Optional flags:
  --user <uid>        Firebase UID of the target user (admin mode)
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

export async function apiKeyListCommand(input: CommandInput): Promise<number> {
  let flags: { user?: string; 'base-url'?: string; json?: boolean; help?: boolean };
  try {
    const parsed = parseArgs({ args: input.argv, options: OPTIONS, strict: true, allowPositionals: false });
    flags = parsed.values;
  } catch (err) {
    input.output.stderr(`mediforce api-key list: ${String(err)}`);
    input.output.stderr('');
    input.output.stderr(HELP);
    return 2;
  }

  if (flags.help === true) { input.output.stdout(HELP); return 0; }

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
    const data = await mediforce.apiKeys.list(flags.user ? { userId: flags.user } : undefined);

    if (jsonMode) {
      printJson(input.output, data);
      return 0;
    }

    const active = data.keys.filter((k) => !k.revokedAt);
    const revoked = data.keys.filter((k) => k.revokedAt);

    if (active.length === 0 && revoked.length === 0) {
      input.output.stdout('No API keys found.');
      return 0;
    }

    if (active.length > 0) {
      input.output.stdout(`Active keys (${active.length}):`);
      for (const k of active) {
        const lastUsed = k.lastUsedAt ? ` | last used: ${k.lastUsedAt.slice(0, 10)}` : '';
        input.output.stdout(`  ${k.keyPrefix}...  ${k.label.padEnd(20)}  created: ${k.createdAt.slice(0, 10)}${lastUsed}  [${k.id}]`);
      }
    }

    if (revoked.length > 0) {
      input.output.stdout(`\nRevoked keys (${revoked.length}):`);
      for (const k of revoked) {
        input.output.stdout(`  ${k.keyPrefix}...  ${k.label.padEnd(20)}  revoked: ${k.revokedAt!.slice(0, 10)}  [${k.id}]`);
      }
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
