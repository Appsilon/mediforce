import type { CoworkSession } from '@mediforce/platform-core';
import type { McpToolDefinition } from '@mediforce/mcp-client';

/**
 * Message format compatible with OpenRouter / OpenAI chat completions API.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  /** Tool calls made by the assistant (for multi-turn tool use) */
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
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
 *
 * The caller must persist the new human turn to the session before calling this —
 * `session.turns` is the single source of truth for conversation state.
 */
export function buildMessages(
  session: CoworkSession,
  stepContext?: Record<string, unknown>,
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  let systemContent = buildSystemPrompt(session);
  if (stepContext && Object.keys(stepContext).length > 0) {
    systemContent += `\n\n## Context from previous step\n\`\`\`json\n${JSON.stringify(stepContext, null, 2)}\n\`\`\``;
  }
  messages.push({ role: 'system', content: systemContent });

  if (session.artifact) {
    messages.push({
      role: 'system',
      content: `## Current artifact state\n\`\`\`json\n${JSON.stringify(session.artifact, null, 2)}\n\`\`\``,
    });
  }

  for (const turn of session.turns) {
    if (turn.role === 'tool') continue;
    messages.push({
      role: turn.role === 'human' ? 'user' : 'assistant',
      content: turn.content,
    });
  }

  return messages;
}

/**
 * Build the tools array for OpenRouter, combining the artifact tool with MCP tools.
 */
export function buildToolsArray(mcpTools?: McpToolDefinition[]): Array<typeof ARTIFACT_TOOL | McpToolDefinition> {
  if (!mcpTools || mcpTools.length === 0) return [ARTIFACT_TOOL];
  return [ARTIFACT_TOOL, ...mcpTools];
}

/**
 * Build a system prompt section listing available MCP servers.
 */
export function buildMcpSystemPromptSection(serverNames: string[]): string {
  if (serverNames.length === 0) return '';
  return (
    '\n\n## Available MCP Tools\n' +
    `You have access to external tools from the following MCP servers: ${serverNames.join(', ')}.\n` +
    'Use these tools to gather information, query external systems, or perform actions as needed. ' +
    'Tool names are prefixed with the server name (e.g., servername__toolname).'
  );
}
