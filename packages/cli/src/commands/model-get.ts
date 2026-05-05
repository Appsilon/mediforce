import { parseArgs } from 'node:util';
import { Mediforce, ApiError } from '@mediforce/platform-api/client';
import { resolveConfig } from '../config.js';
import { printJson, printError, type OutputSink } from '../output.js';

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

const HELP = `Usage: mediforce model get <model-id>

Fetch a single model from the registry.

Example:
  mediforce model get anthropic/claude-sonnet-4

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

export async function modelGetCommand(input: CommandInput): Promise<number> {
  let flags: { 'base-url'?: string; json?: boolean; help?: boolean };
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: input.argv,
      options: GET_OPTIONS,
      strict: true,
      allowPositionals: true,
    });
    flags = parsed.values;
    positionals = parsed.positionals;
  } catch (err) {
    input.output.stderr(`mediforce model get: ${String(err)}`);
    input.output.stderr('');
    input.output.stderr(HELP);
    return 2;
  }
  const jsonMode = flags.json === true;

  if (flags.help === true) {
    input.output.stdout(HELP);
    return 0;
  }

  const modelId = positionals[0];
  if (!modelId) {
    input.output.stderr('mediforce model get: missing <model-id> argument');
    input.output.stderr('');
    input.output.stderr(HELP);
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
    const result = await mediforce.models.get({ id: modelId });
    if (jsonMode) {
      printJson(input.output, result);
      return 0;
    }
    const m = result.model;
    input.output.stdout(`Model: ${m.name} (${m.id})`);
    input.output.stdout(`Provider:    ${m.provider}`);
    input.output.stdout(`Context:     ${String(m.contextLength)} tokens`);
    input.output.stdout(`Max output:  ${m.maxCompletionTokens !== null ? String(m.maxCompletionTokens) : 'unknown'}`);
    input.output.stdout(`Modality:    ${m.modality}`);
    input.output.stdout(`Tools:       ${m.supportsTools ? 'yes' : 'no'}`);
    input.output.stdout(`Vision:      ${m.supportsVision ? 'yes' : 'no'}`);
    input.output.stdout(`Pricing:     in=$${(m.pricing.input * 1_000_000).toFixed(2)}/M  out=$${(m.pricing.output * 1_000_000).toFixed(2)}/M`);
    input.output.stdout(`Source:      ${m.source}`);
    input.output.stdout(`Last synced: ${m.lastSyncedAt}`);
    return 0;
  } catch (err) {
    if (err instanceof ApiError) {
      printError(input.output, { error: err.message, status: err.status, body: err.body }, jsonMode);
    } else {
      printError(input.output, { error: String(err) }, jsonMode);
    }
    return 1;
  }
}
