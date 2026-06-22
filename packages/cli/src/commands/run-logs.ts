import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const runLogsCommand = defineCommand({
  name: 'mediforce run logs',
  description: 'Show audit events and step executions for a run.',
  args: {
    runId: { type: 'positional', required: true, description: 'Run identifier' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const [auditResult, stepsResult] = await Promise.all([
      mediforce.processes.listAuditEvents({ instanceId: args.runId }),
      mediforce.processes.getSteps({ instanceId: args.runId }),
    ]);

    if (jsonMode) {
      printJson(output, {
        runId: args.runId,
        auditEvents: auditResult.events,
        steps: stepsResult.steps,
      });
      return 0;
    }

    output.stdout(`Logs for run ${args.runId}`);
    output.stdout('');

    if (stepsResult.steps.length > 0) {
      output.stdout('Steps:');
      for (const step of stepsResult.steps) {
        const execs = [...step.executions].sort(
          (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
        );
        if (execs.length === 0) {
          output.stdout(`  ${step.status.padEnd(12)} ${step.stepId}`);
        } else {
          for (const exec of execs) {
            const duration =
              exec.startedAt && exec.completedAt
                ? `${Math.round((new Date(exec.completedAt).getTime() - new Date(exec.startedAt).getTime()) / 1000)}s`
                : '';
            output.stdout(`  ${exec.status.padEnd(12)} ${step.stepId}${duration ? `  (${duration})` : ''}`);
            if (exec.error) output.stdout(`             error: ${exec.error}`);
            if (exec.verdict) output.stdout(`             verdict: ${exec.verdict}`);
          }
        }
      }
      output.stdout('');
    }

    if (auditResult.events.length > 0) {
      output.stdout('Audit trail:');
      for (const event of auditResult.events) {
        const time = event.timestamp.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
        output.stdout(`  ${time}  ${event.action}  ${event.description}`);
      }
    }

    return 0;
  },
});
