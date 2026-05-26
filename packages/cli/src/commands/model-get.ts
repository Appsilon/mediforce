import { defineCommand } from '../define-command.js';
import { printJson } from '../output.js';

const HELP = `Usage: mediforce model get <model-id>

Fetch a single model from the registry.

Example:
  mediforce model get anthropic/claude-sonnet-4

Optional flags:
  --base-url <url>     API base URL (default: http://localhost:9003)
  --json               Emit JSON instead of human-readable output
  --help, -h           Show this help text
`;

export const modelGetCommand = defineCommand({
  name: 'model get',
  help: HELP,
  options: {
    'base-url': { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } as const,
  positionals: ['<model-id>'] as const,
  handler: async ({ positionals, mediforce, output, jsonMode }) => {
    const modelId = positionals[0]!;
    const result = await mediforce.models.get({ id: modelId });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    const m = result.model;
    output.stdout(`Model: ${m.name} (${m.id})`);
    output.stdout(`Provider:    ${m.provider}`);
    output.stdout(`Context:     ${String(m.contextLength)} tokens`);
    output.stdout(`Max output:  ${m.maxCompletionTokens !== null ? String(m.maxCompletionTokens) : 'unknown'}`);
    output.stdout(`Modality:    ${m.modality}`);
    output.stdout(`Tools:       ${m.supportsTools ? 'yes' : 'no'}`);
    output.stdout(`Vision:      ${m.supportsVision ? 'yes' : 'no'}`);
    output.stdout(`Pricing:     in=$${(m.pricing.input * 1_000_000).toFixed(2)}/M  out=$${(m.pricing.output * 1_000_000).toFixed(2)}/M`);
    output.stdout(`Source:      ${m.source}`);
    output.stdout(`Last synced: ${m.lastSyncedAt}`);
    return 0;
  },
});
