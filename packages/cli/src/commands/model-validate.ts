import { defineCommand } from '../define-command';
import { printJson, printError } from '../output';

function parseModelIds(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export const modelValidateCommand = defineCommand({
  name: 'mediforce model validate',
  description: 'Validate whether model IDs exist in the registry.',
  args: {
    modelIds: {
      type: 'positional',
      required: true,
      description: 'Comma-separated model IDs (e.g. anthropic/claude-sonnet-4,openai/gpt-4o)',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const ids = parseModelIds(args.modelIds);
    if (ids.length === 0) {
      printError(output, { error: 'at least one model ID is required' }, jsonMode);
      return 2;
    }

    const result = await mediforce.models.validate({ modelIds: ids });

    if (jsonMode) {
      printJson(output, result);
      return result.unknown.length > 0 ? 1 : 0;
    }

    if (result.unknown.length === 0) {
      output.stdout('All models found in registry.');
      return 0;
    }

    output.stdout(`${String(result.unknown.length)} unknown model(s):\n`);
    for (const entry of result.unknown) {
      const suggestion = entry.suggestion !== null ? `  (did you mean: ${entry.suggestion})` : '';
      output.stdout(`  ${entry.id}${suggestion}`);
    }
    return 1;
  },
});
