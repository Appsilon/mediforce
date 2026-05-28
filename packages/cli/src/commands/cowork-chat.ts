import { defineCommand } from '../define-command.js';
import { printJson, printKv } from '../output.js';

export const coworkChatCommand = defineCommand({
  name: 'mediforce cowork chat',
  description: 'Send a chat message to a cowork session and print the agent reply.',
  args: {
    sessionId: { type: 'positional', required: true, description: 'Session id' },
    message: { type: 'string', required: true, description: 'Message text to send' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.cowork.chat({
      sessionId: args.sessionId,
      message: args.message,
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Reply (turn ${result.turnId}):`);
    output.stdout(result.agentText);
    printKv(output, [
      ['toolCalls', String(result.toolCalls.length)],
      ['artifact', result.artifact !== undefined ? 'updated' : '(unchanged)'],
      ['totalTurns', String(result.turns.length)],
    ]);
    return 0;
  },
});
