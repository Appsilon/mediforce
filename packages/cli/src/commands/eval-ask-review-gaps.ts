import { defineCommand, parsePositiveIntArg } from '../define-command';
import { printJson } from '../output';
import { SUBJECT_ARGS, subjectFrom } from './eval-step-args';

export const evalAskReviewGapsCommand = defineCommand({
  name: 'mediforce eval ask-review-gaps',
  description: 'Feed review_gap Scores since --since into the step\'s Evaluation Assistant, only if at least one is a real miss. Proposals are printed, not applied.',
  args: {
    ...SUBJECT_ARGS,
    since: { type: 'string', required: true, description: 'ISO timestamp — only review_gap Scores recorded at or after this count' },
    version: { type: 'string', description: 'Workflow Definition version whose step the assistant reads and runs (default: the runnable one)' },
    model: { type: 'string', description: 'OpenRouter model id' },
    'unattended-budget': { type: 'string', description: 'USD the assistant may spend starting prepared Eval Runs during this request, without asking (default: none — starting a run is refused)' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const version = parsePositiveIntArg(args.version);
    if (version === 'invalid') {
      output.stderr('--version must be a positive integer');
      return 2;
    }
    const unattendedBudget = args['unattended-budget'] === undefined ? undefined : Number(args['unattended-budget']);
    if (unattendedBudget !== undefined && (Number.isFinite(unattendedBudget) === false || unattendedBudget <= 0)) {
      output.stderr('--unattended-budget must be a positive number of USD');
      return 2;
    }

    const result = await mediforce.evaluation.askAboutReviewGaps({
      ...subjectFrom(args),
      since: args.since,
      ...(version !== undefined ? { definitionVersion: version } : {}),
      ...(args.model !== undefined ? { model: args.model } : {}),
      ...(unattendedBudget !== undefined ? { unattendedBudgetUsd: unattendedBudget } : {}),
    });

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.assistant === null) {
      output.stdout(`No review_gap misses since ${args.since}. Nothing asked.`);
      return 0;
    }
    output.stdout(`${result.missedCount} review_gap miss(es) since ${args.since} — asked the Evaluation Assistant.\n`);
    output.stdout(result.assistant.reply);
    for (const proposal of result.assistant.proposals) {
      output.stdout(`\nproposal ${proposal.tool}: ${JSON.stringify(proposal.arguments, null, 2)}`);
    }
    return 0;
  },
});
