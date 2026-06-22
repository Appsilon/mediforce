import { defineCommand } from '../define-command';
import { printJson } from '../output';

/**
 * `mediforce processes agent-events <instanceId> [--step-id <id>]` —
 * dump the agent-event feed for a process instance, sorted by sequence ASC.
 *
 * Optional `--step-id` narrows to one step. JSON output mirrors the
 * `{ events }` envelope; the human-readable fallback prints one line per
 * event.
 */
export const processesAgentEventsCommand = defineCommand({
  name: 'mediforce processes agent-events',
  description: 'Dump the agent-event feed for a process instance.',
  args: {
    instanceId: {
      type: 'positional',
      required: true,
      description: 'Process instance id',
    },
    'step-id': {
      type: 'string',
      description: 'Narrow to one step',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.processes.agentEvents({
      instanceId: args.instanceId,
      stepId: args['step-id'],
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.events.length === 0) {
      output.stdout('No agent events.');
      return 0;
    }
    for (const event of result.events) {
      output.stdout(`[${String(event.sequence).padStart(4, '0')}] ${event.stepId} ${event.type} ${event.timestamp}`);
    }
    return 0;
  },
});
