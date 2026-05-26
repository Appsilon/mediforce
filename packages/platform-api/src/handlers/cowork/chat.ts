import { McpClientManager, type McpToolDefinition } from '@mediforce/mcp-client';
import { PreconditionFailedError, HandlerError } from '../../errors.js';
import { loadOr404 } from '../_helpers.js';
import type { CallerScope } from '../../repositories/index.js';
import type {
  ChatCoworkSessionInput,
  ChatCoworkSessionOutput,
  ChatCoworkToolCall,
} from '../../contract/cowork.js';
import {
  buildMessages,
  buildToolsArray,
  buildMcpSystemPromptSection,
  type ChatMessage,
} from './_lib/build-messages.js';
import { callOpenRouter } from './_lib/openrouter.js';

const MAX_TOOL_LOOP_ITERATIONS = 10;

/**
 * Chat turn — runs the MCP tool loop server-side and persists intermediate
 * tool turns so the UI can observe them live via its Firestore subscription.
 * Parity migration of the existing route — no audit emission, no streaming.
 */
export async function chatCoworkSession(
  input: ChatCoworkSessionInput,
  scope: CallerScope,
): Promise<ChatCoworkSessionOutput> {
  const session = await loadOr404(
    scope.coworkSessions.getById(input.sessionId),
    `Cowork session '${input.sessionId}' not found`,
  );

  if (session.status !== 'active') {
    throw new PreconditionFailedError(
      `Cannot message a ${session.status} session`,
      { sessionId: input.sessionId, status: session.status },
    );
  }

  const instance = await loadOr404(
    scope.runs.getById(session.processInstanceId),
    `Process instance '${session.processInstanceId}' not found`,
  );

  const namespace = instance.namespace;
  const workflowName = instance.definitionName;
  if (typeof namespace !== 'string' || namespace.length === 0 || !workflowName) {
    throw new HandlerError('validation', 'Cannot resolve workspace for this session');
  }

  const [nsSecrets, wfSecrets] = await Promise.all([
    scope.workspaceSecrets.getSecrets(namespace),
    scope.workflowSecrets.getSecrets(namespace, workflowName),
  ]);
  const openRouterKey = { ...nsSecrets, ...wfSecrets }['OPENROUTER_API_KEY'];
  if (!openRouterKey) {
    throw new HandlerError(
      'validation',
      'OPENROUTER_API_KEY not configured in workspace secrets',
    );
  }

  const stepContext = instance.variables as Record<string, unknown> | undefined;

  // Connect to MCP servers BEFORE persisting the human turn so a connection
  // failure does not leave an orphan user message with no agent reply.
  let mcpManager: McpClientManager | null = null;
  let mcpTools: McpToolDefinition[] = [];
  if (session.mcpServers && session.mcpServers.length > 0) {
    mcpManager = new McpClientManager(session.mcpServers);
    try {
      mcpTools = await mcpManager.connect();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HandlerError('internal', `Failed to connect to MCP servers: ${message}`);
    }
  }

  const humanTurnId = crypto.randomUUID();
  await scope.coworkSessions.addTurn(input.sessionId, {
    id: humanTurnId,
    role: 'human',
    content: input.message,
    timestamp: new Date().toISOString(),
    artifactDelta: null,
  });

  const updatedSession = await loadOr404(
    scope.coworkSessions.getById(input.sessionId),
    'Session disappeared after saving human turn',
  );

  try {
    const messages = buildMessages(updatedSession, stepContext);

    if (mcpTools.length > 0 && session.mcpServers) {
      const serverNames = session.mcpServers.map((s) => s.name);
      messages[0].content += buildMcpSystemPromptSection(serverNames);
    }

    const model = session.model ?? 'anthropic/claude-sonnet-4';
    const tools = buildToolsArray(mcpTools);
    const toolCallSummaries: ChatCoworkToolCall[] = [];
    let artifact: Record<string, unknown> | undefined;
    let agentText = '';

    for (let iteration = 0; iteration < MAX_TOOL_LOOP_ITERATIONS; iteration++) {
      const response = await callOpenRouter(model, messages, tools, openRouterKey);
      agentText = response.content;

      const artifactCalls = response.toolCalls.filter(
        (tc) => tc.function.name === 'update_artifact',
      );
      const mcpCalls = response.toolCalls.filter(
        (tc) => tc.function.name !== 'update_artifact',
      );

      for (const toolCall of artifactCalls) {
        try {
          const parsed = JSON.parse(toolCall.function.arguments) as {
            artifact: Record<string, unknown>;
          };
          artifact = parsed.artifact;
          await scope.coworkSessions.updateArtifact(input.sessionId, artifact);
        } catch {
          // Skip malformed artifact tool calls.
        }
      }

      if (mcpCalls.length === 0) break;

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: agentText,
        tool_calls: response.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      };
      messages.push(assistantMessage);

      for (const toolCall of mcpCalls) {
        const toolName = toolCall.function.name;
        const separatorIndex = toolName.indexOf('__');
        const serverName = separatorIndex > 0 ? toolName.slice(0, separatorIndex) : 'unknown';

        let toolArgs: Record<string, unknown> = {};
        try {
          toolArgs = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
        } catch {
          // Use empty args if parsing fails.
        }

        const toolTurnId = crypto.randomUUID();
        await scope.coworkSessions.addTurn(input.sessionId, {
          id: toolTurnId,
          role: 'tool',
          content: '',
          timestamp: new Date().toISOString(),
          artifactDelta: null,
          toolName,
          toolArgs,
          toolStatus: 'running',
          serverName,
        });

        const result = await mcpManager!.callTool(toolName, toolArgs);

        await scope.coworkSessions.updateTurn(input.sessionId, toolTurnId, {
          toolResult: result.content,
          toolStatus: result.isError ? 'error' : 'success',
        });

        toolCallSummaries.push({
          name: toolName,
          serverName,
          status: result.isError ? 'error' : 'success',
        });

        messages.push({
          role: 'tool',
          content: result.content,
          tool_call_id: toolCall.id,
        });
      }
    }

    const agentTurnId = crypto.randomUUID();
    await scope.coworkSessions.addTurn(input.sessionId, {
      id: agentTurnId,
      role: 'agent',
      content: agentText,
      timestamp: new Date().toISOString(),
      artifactDelta: artifact ?? null,
    });

    return {
      turnId: agentTurnId,
      agentText,
      artifact,
      toolCalls: toolCallSummaries,
    };
  } finally {
    if (mcpManager) {
      await mcpManager.disconnect().catch(() => {});
    }
  }
}

