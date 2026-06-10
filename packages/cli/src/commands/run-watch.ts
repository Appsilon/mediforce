import { defineCommand } from '../define-command';
import { printJson } from '../output';

const TERMINAL_STATUSES = new Set(['completed', 'failed']);
const POLL_INTERVAL_MS = 2000;

export const runWatchCommand = defineCommand({
  name: 'mediforce run watch',
  description: 'Watch a run until it reaches a terminal state, streaming step events.',
  args: {
    runId: { type: 'positional', required: true, description: 'Run identifier' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const seenSteps = new Set<string>();
    let lastStatus = '';

    output.stdout(`Watching run ${args.runId} ...`);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const run = await mediforce.runs.get({ runId: args.runId });

      if (run.status !== lastStatus) {
        lastStatus = run.status;
        if (jsonMode) {
          printJson(output, { type: 'status', runId: run.runId, status: run.status, currentStepId: run.currentStepId });
        } else {
          const dryLabel = run.dryRun ? ' [DRY RUN]' : '';
          output.stdout(`→ ${run.status}${run.currentStepId ? ` (step: ${run.currentStepId})` : ''}${dryLabel}`);
        }
      }

      const steps = await mediforce.processes.getSteps({ instanceId: args.runId });
      for (const step of steps.steps) {
        const exec = step.latestExecution;
        const key = `${step.stepId}:${exec?.status ?? step.status}`;
        if (seenSteps.has(key)) continue;
        seenSteps.add(key);

        const status = exec?.status ?? step.status;
        const duration = exec?.startedAt && exec?.completedAt
          ? ` (${Math.round((new Date(exec.completedAt).getTime() - new Date(exec.startedAt).getTime()) / 1000)}s)`
          : '';

        if (jsonMode) {
          printJson(output, { type: 'step', stepId: step.stepId, status, duration });
        } else {
          output.stdout(`  ${status.padEnd(12)} ${step.stepId}${duration}`);
          if (exec?.error) output.stdout(`             error: ${exec.error}`);
        }
      }

      if (TERMINAL_STATUSES.has(run.status)) {
        if (!jsonMode) {
          output.stdout('');
          output.stdout(`Run ${run.status}.`);
          if (run.error) output.stdout(`Error: ${run.error}`);
        }
        return run.status === 'completed' ? 0 : 1;
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  },
});
