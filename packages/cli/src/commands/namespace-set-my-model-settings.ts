import { OutputBudgetSchema, type OutputBudget } from '@mediforce/platform-core';
import { defineCommand } from '../define-command';
import { printJson, printKv } from '../output';

export const namespaceSetMyModelSettingsCommand = defineCommand({
  name: 'mediforce namespace set-my-model-settings',
  description: 'Set your own default model and LLM output budget in an organization workspace, overriding the workspace.',
  args: {
    handle: { type: 'string', required: true, description: 'Workspace handle' },
    'output-budget': {
      type: 'string',
      description: 'low | default | high | max, or "workspace" to follow the workspace budget',
    },
    'default-model': {
      type: 'string',
      description: 'Model id, e.g. anthropic/claude-sonnet-5.5, or "workspace" to follow the workspace default',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    if (args['output-budget'] === undefined && args['default-model'] === undefined) {
      output.stderr('Pass --output-budget, --default-model, or both');
      return 2;
    }

    const input: Parameters<typeof mediforce.namespaces.setMyModelSettings>[0] = { handle: args.handle };
    if (args['output-budget'] !== undefined) {
      let outputBudget: OutputBudget | null = null;
      if (args['output-budget'] !== 'workspace') {
        const parsed = OutputBudgetSchema.safeParse(args['output-budget']);
        if (parsed.success === false) {
          output.stderr(`Invalid output budget '${args['output-budget']}' — expected low, default, high, max, or workspace`);
          return 2;
        }
        outputBudget = parsed.data;
      }
      input.outputBudget = outputBudget;
    }
    if (args['default-model'] !== undefined) {
      input.defaultModel = args['default-model'] === 'workspace' ? null : args['default-model'];
    }

    const result = await mediforce.namespaces.setMyModelSettings(input);

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }

    output.stdout(`Updated your model settings in ${args.handle}`);
    printKv(output, [
      ['outputBudget', result.member.outputBudget ?? 'workspace'],
      ['defaultModel', result.member.defaultModel ?? 'workspace'],
    ]);
    return 0;
  },
});
