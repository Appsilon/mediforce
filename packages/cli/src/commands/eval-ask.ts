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
    'unattended-budget': { type: 'string', description: 'USD the assistant may spend starting prepared Eval Runs during this request, without asking (default: none — starting a run is refused)' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const unattendedBudget = args['unattended-budget'] === undefined ? undefined : Number(args['unattended-budget']);
    if (unattendedBudget !== undefined && (Number.isFinite(unattendedBudget) === false || unattendedBudget <= 0)) {
      output.stderr('--unattended-budget must be a positive number of USD');
      return 2;
    }
    const result = await mediforce.evaluation.askAssistant({
      ...stepFrom(args),
      messages: [{ role: 'user', content: args.message }],
      ...(args.model !== undefined ? { model: args.model } : {}),
      ...(unattendedBudget !== undefined ? { unattendedBudgetUsd: unattendedBudget } : {}),
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
      if (proposal.selfTest === undefined) continue;
      if ('unavailable' in proposal.selfTest) {
        output.stdout(`not tried on real outputs: ${proposal.selfTest.unavailable}`);
        continue;
      }
      const { results } = proposal.selfTest;
      const count = (predicate: (passed: boolean | null) => boolean) => results.filter((outcome) => predicate(outcome.passed)).length;
      output.stdout(`tried on ${results.length} recent output(s): ${count((passed) => passed === true)} pass, ${count((passed) => passed === false)} fail, ${count((passed) => passed === null)} error`);
    }
    for (const run of result.preparedEvalRuns) {
      output.stdout(`\nprepared Eval Run ${run.evalRunId}: ${run.trials} trial(s), budget $${run.budgetUsd}. Start it with: mediforce eval run-start ${run.evalRunId} --confirm-budget ${run.budgetUsd}`);
    }
    for (const run of result.startedEvalRuns) {
      output.stdout(`\nstarted Eval Run ${run.evalRunId} under the unattended budget (up to $${run.budgetUsd}). Read it with: mediforce eval report ${run.evalRunId}`);
    }
    return 0;
  },
});
