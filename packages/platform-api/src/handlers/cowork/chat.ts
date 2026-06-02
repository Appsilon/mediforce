import {
  McpClientManager,
  type McpToolDefinition,
} from '@mediforce/mcp-client';
import type { ConversationTurn, CoworkSession } from '@mediforce/platform-core';
import {
  HandlerError,
  PreconditionFailedError,
} from '../../errors';
import { loadOr404 } from '../_helpers';
import type { CallerScope } from '../../repositories/index';
import type {
  ChatCoworkSessionInput,
  ChatCoworkSessionOutput,
  ChatCoworkToolCall,
} from '../../contract/cowork';
import {
  buildMessages,
  buildToolsArray,
  buildMcpSystemPromptSection,
  type ChatMessage,
} from './_lib/build-messages';
import {
  callOpenRouter,
  type OpenRouterToolCall,
} from '../../services/openrouter-client';
import { validateOutputSchema, type OutputSchema } from '@mediforce/agent-runtime';

const MAX_TOOL_LOOP_ITERATIONS = 10;
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4';

/**
 * Chat turn — orchestrates the MCP tool loop server-side. Intermediate tool
 * turns are persisted to the session as they execute so the UI can observe
 * them live via its Firestore subscription. Parity migration of the existing
 * route: no audit emission, no streaming.
 */
export async function chatCoworkSession(
  input: ChatCoworkSessionInput,
  scope: CallerScope,
): Promise<ChatCoworkSessionOutput> {
  const ctx = await loadChatContext(input.sessionId, scope);
  const mcp = await connectMcp(ctx.session);
  try {
    await addTurn(scope, input.sessionId, humanTurn(input.message));
    const reloaded = await loadOr404(
      scope.coworkSessions.getById(input.sessionId),
      'Session disappeared after saving human turn',
    );
    const result = await runToolLoop({ scope, ctx, reloaded, mcp });
    const agentTurnId = await addTurn(
      scope,
      input.sessionId,
      agentTurn(result.agentText, result.artifact ?? null),
    );
    const finalSession = await loadOr404(
      scope.coworkSessions.getById(input.sessionId),
      'Session disappeared after saving agent turn',
    );
    return {
      turnId: agentTurnId,
      ...result,
      session: finalSession,
      turns: finalSession.turns,
    };
  } finally {
    if (mcp !== null) await mcp.manager.disconnect().catch(() => {});
  }
}

interface ChatContext {
  readonly session: CoworkSession;
  readonly openRouterKey: string;
  readonly stepContext: Record<string, unknown> | undefined;
  readonly model: string;
}

async function loadChatContext(
  sessionId: string,
  scope: CallerScope,
): Promise<ChatContext> {
  const session = await loadOr404(
    scope.coworkSessions.getById(sessionId),
    `Cowork session '${sessionId}' not found`,
  );

  if (session.status !== 'active') {
    throw new PreconditionFailedError(
      `Cannot message a ${session.status} session`,
      { sessionId, status: session.status },
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

  const secrets = await scope.workspaceSecrets.getRuntimeSecrets(namespace, workflowName);
  const openRouterKey = secrets['OPENROUTER_API_KEY'];
  if (!openRouterKey) {
    throw new HandlerError(
      'validation',
      'OPENROUTER_API_KEY not configured in workspace secrets',
    );
  }

  return {
    session,
    openRouterKey,
    stepContext: instance.variables as Record<string, unknown> | undefined,
    model: session.model ?? DEFAULT_MODEL,
  };
}

interface McpHandle {
  readonly manager: McpClientManager;
  readonly tools: McpToolDefinition[];
}

async function connectMcp(session: CoworkSession): Promise<McpHandle | null> {
  if (!session.mcpServers || session.mcpServers.length === 0) return null;
  const manager = new McpClientManager(session.mcpServers);
  try {
    const tools = await manager.connect();
    return { manager, tools };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new HandlerError('internal', `Failed to connect to MCP servers: ${message}`);
  }
}

function humanTurn(content: string): ConversationTurn {
  return {
    id: crypto.randomUUID(),
    role: 'human',
    content,
    timestamp: new Date().toISOString(),
    artifactDelta: null,
  };
}

function agentTurn(
  content: string,
  artifactDelta: Record<string, unknown> | null,
): ConversationTurn {
  return {
    id: crypto.randomUUID(),
    role: 'agent',
    content,
    timestamp: new Date().toISOString(),
    artifactDelta,
  };
}

function toolRunningTurn(
  toolName: string,
  serverName: string,
  toolArgs: Record<string, unknown>,
): ConversationTurn {
  return {
    id: crypto.randomUUID(),
    role: 'tool',
    content: '',
    timestamp: new Date().toISOString(),
    artifactDelta: null,
    toolName,
    toolArgs,
    toolStatus: 'running',
    serverName,
  };
}

async function addTurn(
  scope: CallerScope,
  sessionId: string,
  turn: ConversationTurn,
): Promise<string> {
  await scope.coworkSessions.addTurn(sessionId, turn);
  return turn.id;
}

interface ToolLoopArgs {
  readonly scope: CallerScope;
  readonly ctx: ChatContext;
  readonly reloaded: CoworkSession;
  readonly mcp: McpHandle | null;
}

interface ToolLoopResult {
  agentText: string;
  artifact: Record<string, unknown> | undefined;
  toolCalls: ChatCoworkToolCall[];
}

async function runToolLoop(args: ToolLoopArgs): Promise<ToolLoopResult> {
  const { scope, ctx, reloaded, mcp } = args;
  const messages = buildMessages(reloaded, ctx.stepContext);
  if (mcp !== null && mcp.tools.length > 0 && ctx.session.mcpServers) {
    const serverNames = ctx.session.mcpServers.map((s) => s.name);
    messages[0].content += buildMcpSystemPromptSection(serverNames);
  }

  const tools = buildToolsArray(mcp?.tools ?? []);
  const toolCallSummaries: ChatCoworkToolCall[] = [];
  let artifact: Record<string, unknown> | undefined;
  let agentText = '';

  for (let iteration = 0; iteration < MAX_TOOL_LOOP_ITERATIONS; iteration++) {
    const response = await callOpenRouter({
      model: ctx.model,
      messages,
      tools,
      apiKey: ctx.openRouterKey,
    });
    agentText = response.content;

    const artifactCalls = response.toolCalls.filter(
      (tc) => tc.function.name === 'update_artifact',
    );
    const presentationCalls = response.toolCalls.filter(
      (tc) => tc.function.name === 'update_presentation',
    );
    const mcpCalls = response.toolCalls.filter(
      (tc) => tc.function.name !== 'update_artifact' && tc.function.name !== 'update_presentation',
    );

    for (const call of artifactCalls) {
      const parsed = applyArtifactUpdate(call);
      if (parsed !== null) {
        artifact = parsed;
        await scope.coworkSessions.updateArtifact(ctx.session.id, parsed);

        if (ctx.session.outputSchema) {
          const error = validateOutputSchema(
            parsed,
            ctx.session.outputSchema as OutputSchema,
          );
          const validationResult = error === null
            ? { valid: true, errors: [] as string[] }
            : { valid: false, errors: [error] };
          await scope.coworkSessions.updateValidationResult(ctx.session.id, validationResult);
        }
      }
    }

    for (const call of presentationCalls) {
      const html = applyPresentationUpdate(call);
      if (html !== null) {
        await scope.coworkSessions.updatePresentation(ctx.session.id, html);
      }
    }

    if (mcpCalls.length === 0) break;
    // mcpCalls non-empty implies the LLM picked at least one MCP tool, which
    // can only happen when `tools` included MCP entries (`mcp !== null`).
    if (mcp === null) break;

    messages.push(assistantMessage(agentText, response.toolCalls));
    for (const call of mcpCalls) {
      const summary = await executeMcpTool(scope, ctx.session.id, mcp, call, messages);
      toolCallSummaries.push(summary);
    }
  }

  return { agentText, artifact, toolCalls: toolCallSummaries };
}

function assistantMessage(
  content: string,
  toolCalls: OpenRouterToolCall[],
): ChatMessage {
  return {
    role: 'assistant',
    content,
    tool_calls: toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.function.name, arguments: tc.function.arguments },
    })),
  };
}

async function executeMcpTool(
  scope: CallerScope,
  sessionId: string,
  mcp: McpHandle,
  call: OpenRouterToolCall,
  messages: ChatMessage[],
): Promise<ChatCoworkToolCall> {
  const toolName = call.function.name;
  const sep = toolName.indexOf('__');
  const serverName = sep > 0 ? toolName.slice(0, sep) : 'unknown';
  const toolArgs = parseToolArgs(call.function.arguments);

  const turn = toolRunningTurn(toolName, serverName, toolArgs);
  await scope.coworkSessions.addTurn(sessionId, turn);

  const result = await mcp.manager.callTool(toolName, toolArgs);
  const status = result.isError ? 'error' : 'success';

  await scope.coworkSessions.updateTurn(sessionId, turn.id, {
    toolResult: result.content,
    toolStatus: status,
  });

  messages.push({
    role: 'tool',
    content: result.content,
    tool_call_id: call.id,
  });

  return { name: toolName, serverName, status };
}

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// Malformed `update_artifact` payloads are skipped (parity with the
// pre-migration route — `null` here means "ignore, keep going").
function applyArtifactUpdate(
  call: OpenRouterToolCall,
): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(call.function.arguments) as {
      artifact: Record<string, unknown>;
    };
    return parsed.artifact;
  } catch {
    return null;
  }
}

function applyPresentationUpdate(
  call: OpenRouterToolCall,
): string | null {
  try {
    const parsed = JSON.parse(call.function.arguments) as { html: string };
    return typeof parsed.html === 'string' ? parsed.html : null;
  } catch {
    return null;
  }
}
