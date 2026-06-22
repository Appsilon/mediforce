import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const modelGetCommand = defineCommand({
  name: 'mediforce model get',
  description: 'Fetch a single model from the registry.',
  args: {
    'model-id': {
      type: 'positional',
      required: true,
      description: 'Model id (e.g. anthropic/claude-sonnet-4)',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.models.get({ id: args['model-id'] });
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
    output.stdout(
      `Pricing:     in=$${(m.pricing.input * 1_000_000).toFixed(2)}/M  out=$${(m.pricing.output * 1_000_000).toFixed(2)}/M`,
    );
    output.stdout(`Source:      ${m.source}`);
    output.stdout(`Last synced: ${m.lastSyncedAt}`);
    return 0;
  },
});
