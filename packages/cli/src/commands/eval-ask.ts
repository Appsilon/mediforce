import { defineCommand } from '../define-command';
import { printJson } from '../output';
import { STEP_ARGS, stepFrom } from './eval-step-args';

export const evalAskCommand = defineCommand({
  name: 'mediforce eval ask',
  description: 'Ask a step\'s Evaluation Assistant one question. Proposals are printed, not applied.',
  args: {
    ...STEP_ARGS,
    message: { type: 'positional', required: true, description: 'What to ask' },
    model: { type: 'string', description: 'OpenRouter model id' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.askAssistant({
      ...stepFrom(args),
      messages: [{ role: 'user', content: args.message }],
      ...(args.model !== undefined ? { model: args.model } : {}),
    }, {
      onProgress: (event) => {
        if (jsonMode === true || event.type !== 'tool' || event.status === 'done') return;
        output.stderr(event.status === 'running' ? `… ${event.tool}` : `✗ ${event.tool}: ${event.error ?? 'failed'}`);
      },
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(result.reply);
    for (const proposal of result.proposals) {
      output.stdout(`\nproposal ${proposal.tool}: ${JSON.stringify(proposal.arguments, null, 2)}`);
    }
    for (const run of result.preparedEvalRuns) {
      output.stdout(`\nprepared Eval Run ${run.evalRunId}: ${run.trials} trial(s), budget $${run.budgetUsd}. Start it with: mediforce eval run-start ${run.evalRunId} --confirm-budget ${run.budgetUsd}`);
    }
    return 0;
  },
});
