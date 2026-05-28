import { defineCommand } from '../define-command.js';
import { printJson, printKv } from '../output.js';

export const coworkGetCommand = defineCommand({
  name: 'mediforce cowork get',
  description: 'Fetch a single cowork session by id.',
  args: {
    sessionId: { type: 'positional', required: true, description: 'Session id' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const session = await mediforce.cowork.get({ sessionId: args.sessionId });
    if (jsonMode) {
      printJson(output, session);
      return 0;
    }
    output.stdout(`Cowork session ${session.id}`);
    printKv(output, [
      ['status', session.status],
      ['agent', session.agent],
      ['instance', session.processInstanceId],
      ['step', session.stepId],
      ['role', session.assignedRole],
      ['assignedUser', session.assignedUserId ?? '(unassigned)'],
      ['model', session.model ?? undefined],
      ['turns', String(session.turns.length)],
      ['hasArtifact', session.artifact !== null ? 'yes' : 'no'],
      ['created', session.createdAt],
      ['finalized', session.finalizedAt ?? undefined],
    ]);
    return 0;
  },
});
