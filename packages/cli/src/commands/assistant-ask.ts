import { readFile } from 'node:fs/promises';
import { defineCommand } from '../define-command';
import { printJson, printError } from '../output';
import type { AskWorkflowAssistantInput } from '@mediforce/platform-api';

export const assistantAskCommand = defineCommand({
  name: 'mediforce assistant ask',
  description:
    "Ask the canvas-first workflow designer's AI Assistant (ADR-0011) a single question, given the current canvas state. One-shot: sends a single user message, not a multi-turn conversation. Useful for testing the endpoint from the shell.",
  args: {
    message: {
      type: 'positional',
      required: true,
      description: 'What to ask or ask the assistant to build',
    },
    definition: {
      type: 'string',
      required: true,
      description: 'Path to a JSON file with the current canvas state ({ steps, transitions })',
    },
    namespace: {
      type: 'string',
      required: true,
      description: 'Namespace to run the assistant in (needed to look up OPENROUTER_API_KEY)',
    },
    model: {
      type: 'string',
      description: 'Model ID override (default: the platform default)',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    let workflowDefinition: AskWorkflowAssistantInput['workflowDefinition'];
    try {
      const raw = await readFile(args.definition, 'utf-8');
      workflowDefinition = JSON.parse(raw) as AskWorkflowAssistantInput['workflowDefinition'];
    } catch (err) {
      printError(output, { error: `Could not read --definition file: ${err instanceof Error ? err.message : String(err)}` }, jsonMode);
      return 2;
    }

    const result = await mediforce!.assistant.ask(
      {
        messages: [{ role: 'user', content: args.message }],
        model: args.model,
        workflowDefinition,
      },
      { namespace: args.namespace },
    );

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }

    if (result.reply) {
      output.stdout(result.reply);
    }
    if (result.toolCalls) {
      for (const toolCall of result.toolCalls) {
        output.stdout(`Tool call: ${toolCall.tool}`);
        output.stdout(JSON.stringify(toolCall.arguments, null, 2));
      }
    } else if (!result.reply) {
      output.stdout('(no reply)');
    }
    return 0;
  },
});
