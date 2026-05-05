import { parseArgs } from 'node:util';
import { Mediforce, ApiError } from '@mediforce/platform-api/client';
import { resolveConfig } from '../config.js';
import { printJson, printError, type OutputSink } from '../output.js';

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

const HELP = `Usage: mediforce model list [options]

List models in the registry.

Optional flags:
  --provider <name>        Filter by provider (e.g. anthropic, openai)
  --tools                  Only models that support tool use
  --vision                 Only models that support vision
  --min-context <tokens>   Only models with at least N context tokens
  --base-url <url>         API base URL (default: http://localhost:9003)
  --json                   Emit JSON instead of human-readable output
  --help, -h               Show this help text
`;

const LIST_OPTIONS = {
  provider: { type: 'string' },
  tools: { type: 'boolean' },
  vision: { type: 'boolean' },
  'min-context': { type: 'string' },
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${String(Math.round(tokens / 1_000_000))}M`;
  return `${String(Math.round(tokens / 1000))}K`;
}

function formatRequests(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M req`;
  if (count >= 1_000) return `${Math.round(count / 1000)}K req`;
  return `${String(count)} req`;
}

function formatPrice(perToken: number): string {
  const perMillion = perToken * 1_000_000;
  if (perMillion === 0) return 'free';
  if (perMillion < 0.01) return `$${perMillion.toFixed(4)}/M`;
  return `$${perMillion.toFixed(2)}/M`;
}

export async function modelListCommand(input: CommandInput): Promise<number> {
  let flags: {
    provider?: string;
    tools?: boolean;
    vision?: boolean;
    'min-context'?: string;
    'base-url'?: string;
    json?: boolean;
    help?: boolean;
  };
  try {
    const parsed = parseArgs({
      args: input.argv,
      options: LIST_OPTIONS,
      strict: true,
      allowPositionals: false,
    });
    flags = parsed.values;
  } catch (err) {
    input.output.stderr(`mediforce model list: ${String(err)}`);
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
    const result = await mediforce.models.list({
      provider: flags.provider,
      supportsTools: flags.tools,
      supportsVision: flags.vision,
      minContextLength: flags['min-context'] ? Number(flags['min-context']) : undefined,
    });
    if (jsonMode) {
      printJson(input.output, result);
      return 0;
    }
    if (result.models.length === 0) {
      input.output.stdout('No models found. Run `mediforce model sync` to populate from OpenRouter.');
      return 0;
    }
    input.output.stdout(`Found ${String(result.models.length)} model(s):\n`);
    for (const model of result.models) {
      const ctx = formatContext(model.contextLength);
      const inPrice = formatPrice(model.pricing.input);
      const outPrice = formatPrice(model.pricing.output);
      const caps = [model.supportsTools ? 'tools' : '', model.supportsVision ? 'vision' : ''].filter(Boolean).join(',');
      const rank = model.requestCount !== null ? formatRequests(model.requestCount) : '';
      input.output.stdout(`  ${model.id.padEnd(40)} ${ctx.padStart(6)}  in:${inPrice.padStart(10)}  out:${outPrice.padStart(10)}  ${rank.padStart(8)}  ${caps}`);
    }
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
