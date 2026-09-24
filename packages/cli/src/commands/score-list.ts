import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const scoreListCommand = defineCommand({
  name: 'mediforce score list',
  description: 'List Scores — quality judgments on agent runs — newest first.',
  args: {
    namespace: { type: 'string', description: 'Filter by workspace handle' },
    'agent-run': { type: 'string', description: 'Scores on this agent run' },
    'run-id': { type: 'string', description: 'Scores within this workflow run' },
    'step-id': { type: 'string', description: 'Scores for this step (requires --run-id)' },
    name: { type: 'string', description: 'One kind of Score, e.g. human_verdict' },
    limit: { type: 'string', description: 'Max results (default: 100, max: 1000)' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const stepId = args['step-id'];
    const runId = args['run-id'];
    if (stepId !== undefined && runId === undefined) {
      output.stderr('--step-id requires --run-id');
      return 2;
    }
    const result = await mediforce.scores.list({
      ...(args.namespace !== undefined ? { namespace: args.namespace } : {}),
      ...(args['agent-run'] !== undefined ? { agentRunId: args['agent-run'] } : {}),
      ...(runId !== undefined ? { runId } : {}),
      ...(stepId !== undefined ? { stepId } : {}),
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.limit !== undefined ? { limit: Number(args.limit) } : {}),
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.scores.length === 0) {
      output.stdout('No scores found.');
      return 0;
    }
    for (const score of result.scores) {
      output.stdout(
        `${score.value.toFixed(2)}  ${score.name.padEnd(16)} ${(score.label ?? '-').padEnd(10)} ${score.source.padEnd(13)} ${score.subject.type}:${score.subject.id}  ${score.createdAt}`,
      );
    }
    return 0;
  },
});
