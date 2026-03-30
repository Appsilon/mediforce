import type { CoworkSession } from '@mediforce/platform-core';

/**
 * Message format compatible with OpenRouter / OpenAI chat completions API.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
}

/**
 * Tool definition for the update_artifact tool.
 * The model calls this to propose artifact updates during conversation.
 */
export const ARTIFACT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'update_artifact',
    description:
      'Update the current artifact. Call this whenever you have enough information to create or modify the artifact. ' +
      'Pass the COMPLETE artifact (not a delta) — the previous version will be replaced entirely.',
    parameters: {
      type: 'object',
      properties: {
        artifact: {
          type: 'object',
          description: 'The complete updated artifact object.',
        },
      },
      required: ['artifact'],
    },
  },
};

/**
 * Build the system prompt for a cowork session.
 * Combines the step-level system prompt with artifact context.
 */
function buildSystemPrompt(session: CoworkSession): string {
  const parts: string[] = [];

  parts.push(
    'You are a collaborative assistant working with a human to build an artifact together. ' +
    'Your goal is to help the human produce a high-quality artifact that satisfies the required schema.',
  );

  if (session.systemPrompt) {
    parts.push(`\n## Task\n${session.systemPrompt}`);
  }

  if (session.outputSchema) {
    parts.push(
      `\n## Output Schema\nThe artifact must conform to this JSON Schema:\n\`\`\`json\n${JSON.stringify(session.outputSchema, null, 2)}\n\`\`\``,
    );
  }

  parts.push(
    '\n## Instructions\n' +
    '- Ask clarifying questions when the human\'s intent is ambiguous.\n' +
    '- Call the `update_artifact` tool whenever you have enough information to create or improve the artifact.\n' +
    '- Always pass the COMPLETE artifact to `update_artifact`, not a partial delta.\n' +
    '- Explain what you changed and why after each artifact update.\n' +
    '- When you believe the artifact is complete, say so and ask the human to review and finalize.',
  );

  return parts.join('\n');
}

/**
 * Build the full message array for a cowork conversation.
 *
 * Structure:
 * 1. System message (task + schema + instructions)
 * 2. If artifact exists: inject it as context
 * 3. Conversation history (turns → user/assistant messages)
 * 4. New human message
 */
export function buildMessages(
  session: CoworkSession,
  newMessage: string,
  stepContext?: Record<string, unknown>,
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  // System prompt
  let systemContent = buildSystemPrompt(session);
  if (stepContext && Object.keys(stepContext).length > 0) {
    systemContent += `\n\n## Context from previous step\n\`\`\`json\n${JSON.stringify(stepContext, null, 2)}\n\`\`\``;
  }
  messages.push({ role: 'system', content: systemContent });

  // Current artifact state (if any)
  if (session.artifact) {
    messages.push({
      role: 'system',
      content: `## Current artifact state\n\`\`\`json\n${JSON.stringify(session.artifact, null, 2)}\n\`\`\``,
    });
  }

  // Conversation history
  for (const turn of session.turns) {
    messages.push({
      role: turn.role === 'human' ? 'user' : 'assistant',
      content: turn.content,
    });
  }

  // New human message
  messages.push({ role: 'user', content: newMessage });

  return messages;
}
