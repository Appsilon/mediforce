import { parseArgs } from 'node:util';
import { Mediforce, ApiError } from '@mediforce/platform-api/client';
import { resolveConfig } from '../config.js';
import { printJson, printError, type OutputSink } from '../output.js';

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

const HELP = `Usage: mediforce api-key create --label <name> [--user <uid>] [options]

Create a personal API key. The plaintext key is shown once — copy it immediately.

With a personal key (mf_): creates a key for yourself.
With the global PLATFORM_API_KEY + --user: creates a key for the specified user.

Required flags:
  --label <name>      Human-readable label for the key

Optional flags:
  --user <uid>        Firebase UID of the target user (admin mode)
  --base-url <url>    API base URL (default: http://localhost:9003)
  --json              Emit JSON instead of human-readable output
  --help, -h          Show this help text
`;

const OPTIONS = {
  label: { type: 'string' },
  user: { type: 'string' },
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export async function apiKeyCreateCommand(input: CommandInput): Promise<number> {
  let flags: { label?: string; user?: string; 'base-url'?: string; json?: boolean; help?: boolean };
  try {
    const parsed = parseArgs({ args: input.argv, options: OPTIONS, strict: true, allowPositionals: false });
    flags = parsed.values;
  } catch (err) {
    input.output.stderr(`mediforce api-key create: ${String(err)}`);
    input.output.stderr('');
    input.output.stderr(HELP);
    return 2;
  }

  if (flags.help === true) { input.output.stdout(HELP); return 0; }

  if (!flags.label) {
    printError(input.output, { error: '--label is required' }, false);
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
    const data = await mediforce.apiKeys.create({
      label: flags.label,
      ...(flags.user ? { userId: flags.user } : {}),
    });

    if (jsonMode) {
      printJson(input.output, data);
      return 0;
    }

    input.output.stdout(`API key created:`);
    input.output.stdout(`  ID:      ${data.id}`);
    input.output.stdout(`  Label:   ${data.label}`);
    input.output.stdout(`  User:    ${data.userId}`);
    input.output.stdout(`  Key:     ${data.plaintext}`);
    input.output.stdout('');
    input.output.stdout('Copy this key now — you will not see it again.');
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
