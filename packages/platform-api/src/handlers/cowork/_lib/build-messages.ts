import type { CoworkSession, ConversationTurn, ToolTurn, AgentTurn } from '@mediforce/platform-core';
import type { McpToolDefinition } from '@mediforce/mcp-client';
import type { OpenRouterChatMessage } from '../../../services/openrouter-client';

/**
 * Message format compatible with OpenRouter / OpenAI chat completions API.
 * Alias of the generic shape in `services/openrouter-client.ts`.
 */
export type ChatMessage = OpenRouterChatMessage;

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

export const PRESENTATION_TOOL = {
  type: 'function' as const,
  function: {
    name: 'update_presentation',
    description:
      'Update the visual presentation shown alongside the artifact. ' +
      'Pass complete HTML content — it will be rendered in a sandboxed iframe with Tailwind CSS available. ' +
      'Use this to show flow diagrams, comparison cards, or other visual representations of the artifact.',
    parameters: {
      type: 'object',
      properties: {
        html: {
          type: 'string',
          description: 'Complete HTML fragment to render. Tailwind CSS 4 classes are available.',
        },
      },
      required: ['html'],
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
      "- Ask clarifying questions when the human's intent is ambiguous.\n" +
      '- Call the `update_artifact` tool whenever you have enough information to create or improve the artifact.\n' +
      '- Call `update_presentation` with an HTML fragment to show a visual representation of the artifact (e.g., a flow diagram).\n' +
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
export function buildMessages(session: CoworkSession, stepContext?: Record<string, unknown>): ChatMessage[] {
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

  messages.push(...buildConversationMessages(session.turns));

  return messages;
}

/**
 * Reconstruct the OpenRouter/OpenAI message history from persisted turns.
 *
 * Persisted order is: human → tool, tool, ... → agent → human → ...
 * Tool turns are saved DURING the tool loop; the agent turn is appended
 * AFTER the loop finishes. So tools PRECEDE their associated agent turn.
 *
 * For each agent turn we collect all immediately preceding tool turns and
 * emit:
 *   1. `assistant` message with `content` + `tool_calls` array
 *   2. `tool` messages with matching `tool_call_id`
 *
 * Tool turns at the tail with no following agent turn are in-progress
 * (current request) — they're already handled by the live `messages` array
 * in the tool loop, so we skip them here.
 */
function buildConversationMessages(turns: ConversationTurn[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let i = 0;

  while (i < turns.length) {
    const turn = turns[i];

    if (turn.role === 'human') {
      messages.push({ role: 'user', content: turn.content });
      i++;
      continue;
    }

    if (turn.role === 'tool') {
      // Collect consecutive tool turns
      const toolTurns: ToolTurn[] = [];
      while (i < turns.length && turns[i].role === 'tool') {
        toolTurns.push(turns[i] as ToolTurn);
        i++;
      }

      // If the next turn is an agent turn, these tools belong to it
      if (i < turns.length && turns[i].role === 'agent') {
        const agentTurn = turns[i] as AgentTurn;

        const toolCalls = toolTurns.map((t, idx) => ({
          id: t.toolCallId ?? `${agentTurn.id}-tc${idx}`,
          type: 'function' as const,
          function: {
            name: t.toolName,
            arguments: JSON.stringify(t.toolArgs),
          },
        }));

        // Assistant message with tool_calls
        messages.push({
          role: 'assistant',
          content: agentTurn.content,
          tool_calls: toolCalls,
        });

        // Tool result messages
        for (let j = 0; j < toolTurns.length; j++) {
          messages.push({
            role: 'tool',
            content: toolTurns[j].toolResult ?? '',
            tool_call_id: toolCalls[j].id,
          });
        }

        i++; // skip the agent turn (already consumed)
      }
      // else: orphan tool turns at the end (current turn's in-progress tools) — skip
      continue;
    }

    if (turn.role === 'agent') {
      // Agent turn with no preceding tool turns — plain text response
      messages.push({ role: 'assistant', content: turn.content });
      i++;
      continue;
    }

    i++;
  }

  return messages;
}

/**
 * Build the tools array for OpenRouter, combining the artifact tool with MCP tools.
 */
export function buildToolsArray(
  mcpTools?: McpToolDefinition[],
): Array<typeof ARTIFACT_TOOL | typeof PRESENTATION_TOOL | McpToolDefinition> {
  const builtins = [ARTIFACT_TOOL, PRESENTATION_TOOL];
  if (!mcpTools || mcpTools.length === 0) return builtins;
  return [...builtins, ...mcpTools];
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
