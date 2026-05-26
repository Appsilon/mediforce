import { defineCommand } from '../define-command.js';
import { printJson } from '../output.js';

const SORT_FIELDS = ['name', 'provider', 'context', 'price-in', 'price-out', 'popularity'] as const;
type SortField = (typeof SORT_FIELDS)[number];

const HELP = `Usage: mediforce model list [options]

List models in the registry.

Optional flags:
  --provider <name>        Filter by provider (e.g. anthropic, openai)
  --tools                  Only models that support tool use
  --vision                 Only models that support vision
  --min-context <tokens>   Only models with at least N context tokens
  --sort <field>           Sort by: ${SORT_FIELDS.join(', ')} (default: name)
  --desc                   Sort descending (default: ascending)
  --base-url <url>         API base URL (default: http://localhost:9003)
  --json                   Emit JSON instead of human-readable output
  --help, -h               Show this help text
`;

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

export const modelListCommand = defineCommand({
  name: 'model list',
  help: HELP,
  options: {
    provider: { type: 'string' },
    tools: { type: 'boolean' },
    vision: { type: 'boolean' },
    'min-context': { type: 'string' },
    sort: { type: 'string' },
    desc: { type: 'boolean' },
    'base-url': { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } as const,
  handler: async ({ flags, mediforce, output, jsonMode }) => {
    const result = await mediforce.models.list({
      provider: flags.provider,
      supportsTools: flags.tools,
      supportsVision: flags.vision,
      minContextLength: flags['min-context'] ? Number(flags['min-context']) : undefined,
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.models.length === 0) {
      output.stdout('No models found. Run `mediforce model sync` to populate from OpenRouter.');
      return 0;
    }
    const sortField = (flags.sort ?? 'name') as SortField;
    if (!SORT_FIELDS.includes(sortField)) {
      output.stderr(`Invalid --sort value: ${sortField}. Valid: ${SORT_FIELDS.join(', ')}`);
      return 2;
    }
    const descending = flags.desc === true;
    const models = [...result.models].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'provider': cmp = a.provider.localeCompare(b.provider); break;
        case 'context': cmp = a.contextLength - b.contextLength; break;
        case 'price-in': cmp = a.pricing.input - b.pricing.input; break;
        case 'price-out': cmp = a.pricing.output - b.pricing.output; break;
        case 'popularity': cmp = (a.requestCount ?? 0) - (b.requestCount ?? 0); break;
      }
      return descending ? -cmp : cmp;
    });

    output.stdout(`Found ${String(models.length)} model(s):\n`);
    output.stdout(`  ${'NAME'.padEnd(40)} ${'CONTEXT'.padStart(8)}  ${'PRICE-IN'.padStart(10)}  ${'PRICE-OUT'.padStart(10)}  ${'POPULARITY'.padStart(10)}  CAPS`);
    output.stdout(`  ${'─'.repeat(40)} ${'─'.repeat(8)}  ${'─'.repeat(10)}  ${'─'.repeat(10)}  ${'─'.repeat(10)}  ${'─'.repeat(12)}`);
    for (const model of models) {
      const ctx = formatContext(model.contextLength);
      const inPrice = formatPrice(model.pricing.input);
      const outPrice = formatPrice(model.pricing.output);
      const caps = [model.supportsTools ? 'tools' : '', model.supportsVision ? 'vision' : ''].filter(Boolean).join(',');
      const rank = model.requestCount !== null ? formatRequests(model.requestCount) : '';
      output.stdout(`  ${model.id.padEnd(40)} ${ctx.padStart(8)}  ${inPrice.padStart(10)}  ${outPrice.padStart(10)}  ${rank.padStart(10)}  ${caps}`);
    }
    return 0;
  },
});
