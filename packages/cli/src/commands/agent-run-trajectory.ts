import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const agentRunTrajectoryCommand = defineCommand({
  name: 'mediforce agent-run trajectory',
  description: 'Print an agent run\'s Agent Trajectory: its tool calls, tool results and text, in order.',
  args: {
    agentRunId: { type: 'positional', required: true, description: 'Agent run id' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const trajectory = await mediforce.agentRuns.trajectory({ agentRunId: args.agentRunId });
    if (jsonMode) {
      printJson(output, trajectory);
      return 0;
    }
    if (trajectory.entries.length === 0) {
      output.stdout('No trajectory recorded for this agent run.');
      return 0;
    }
    for (const entry of trajectory.entries) {
      const kind = entry.subtype !== undefined ? `${entry.type}/${entry.subtype}` : entry.type;
      const tool = entry.tool ?? entry.tool_name;
      const detail = entry.input !== undefined
        ? JSON.stringify(entry.input)
        : entry.text ?? (typeof entry.content === 'string' ? entry.content : '');
      output.stdout(
        `${String(entry.seq).padStart(4)}  ${entry.ts}  ${kind}${tool !== undefined ? `  ${tool}` : ''}${detail !== '' ? `  ${detail.slice(0, 160)}` : ''}`,
      );
    }
    if (trajectory.entries.some((entry) => entry.redacted === true)) {
      output.stdout('\nContent capture is off on this deployment: values show their size only.');
    }
    return 0;
  },
});
