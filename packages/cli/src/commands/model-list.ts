import { defineCommand, enumArg } from '../define-command';
import { printJson } from '../output';

const SORT_FIELDS = ['name', 'provider', 'context', 'price-in', 'price-out', 'popularity'] as const;
type SortField = (typeof SORT_FIELDS)[number];

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
  name: 'mediforce model list',
  description: 'List models in the registry.',
  args: {
    provider: { type: 'string', description: 'Filter by provider (e.g. anthropic, openai)' },
    tools: { type: 'boolean', description: 'Only models that support tool use' },
    vision: { type: 'boolean', description: 'Only models that support vision' },
    'min-context': { type: 'string', description: 'Only models with at least N context tokens' },
    sort: enumArg(SORT_FIELDS, { description: `Sort by field (default: name)` }),
    desc: { type: 'boolean', description: 'Sort descending (default: ascending)' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.models.list({
      provider: args.provider,
      supportsTools: args.tools,
      supportsVision: args.vision,
      minContextLength: args['min-context'] !== undefined ? Number(args['min-context']) : undefined,
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.models.length === 0) {
      output.stdout('No models found. Run `mediforce model sync` to populate from OpenRouter.');
      return 0;
    }
    const sortField: SortField = args.sort ?? 'name';
    const descending = args.desc === true;
    const models = [...result.models].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'provider':
          cmp = a.provider.localeCompare(b.provider);
          break;
        case 'context':
          cmp = a.contextLength - b.contextLength;
          break;
        case 'price-in':
          cmp = a.pricing.input - b.pricing.input;
          break;
        case 'price-out':
          cmp = a.pricing.output - b.pricing.output;
          break;
        case 'popularity':
          cmp = (a.requestCount ?? 0) - (b.requestCount ?? 0);
          break;
      }
      return descending ? -cmp : cmp;
    });

    output.stdout(`Found ${String(models.length)} model(s):\n`);
    output.stdout(
      `  ${'NAME'.padEnd(40)} ${'CONTEXT'.padStart(8)}  ${'PRICE-IN'.padStart(10)}  ${'PRICE-OUT'.padStart(10)}  ${'POPULARITY'.padStart(10)}  CAPS`,
    );
    output.stdout(
      `  ${'─'.repeat(40)} ${'─'.repeat(8)}  ${'─'.repeat(10)}  ${'─'.repeat(10)}  ${'─'.repeat(10)}  ${'─'.repeat(12)}`,
    );
    for (const model of models) {
      const ctx = formatContext(model.contextLength);
      const inPrice = formatPrice(model.pricing.input);
      const outPrice = formatPrice(model.pricing.output);
      const caps = [model.supportsTools ? 'tools' : '', model.supportsVision ? 'vision' : ''].filter(Boolean).join(',');
      const rank = model.requestCount !== null ? formatRequests(model.requestCount) : '';
      output.stdout(
        `  ${model.id.padEnd(40)} ${ctx.padStart(8)}  ${inPrice.padStart(10)}  ${outPrice.padStart(10)}  ${rank.padStart(10)}  ${caps}`,
      );
    }
    return 0;
  },
});
