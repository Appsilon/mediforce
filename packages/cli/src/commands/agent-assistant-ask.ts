import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const agentAssistantAskCommand = defineCommand({
  name: 'mediforce agent assistant-ask',
  description:
    'Ask the Agent catalog\'s AI Assistant a single question. One-shot: sends a single user message, not a multi-turn conversation. Useful for testing the endpoint from the shell.',
  args: {
    message: {
      type: 'positional',
      required: true,
      description: 'What to ask, e.g. the agent or task you need',
    },
    namespace: {
      type: 'string',
      required: true,
      description: 'Namespace to run the assistant in (needed to look up OPENROUTER_API_KEY and the Agent catalog)',
    },
    model: {
      type: 'string',
      description: 'Model ID override (default: the platform default)',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce!.agents.askAssistant({
      namespace: args.namespace,
      messages: [{ role: 'user', content: args.message }],
      model: args.model,
    });

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }

    output.stdout(result.reply || '(no reply)');
    return 0;
  },
});
