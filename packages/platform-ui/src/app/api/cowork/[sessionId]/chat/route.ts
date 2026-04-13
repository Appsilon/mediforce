import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices, validateApiKey } from '@/lib/platform-services';
import { buildMessages, buildToolsArray, buildMcpSystemPromptSection } from '@/lib/cowork/build-messages';
import { callOpenRouter } from '@/lib/cowork/openrouter';
import { McpClientManager } from '@mediforce/mcp-client';
import type { McpToolDefinition } from '@mediforce/mcp-client';

const MAX_TOOL_LOOP_ITERATIONS = 10;

interface ToolCallSummary {
  name: string;
  serverName: string;
  status: 'success' | 'error';
}

/**
 * POST /api/cowork/:sessionId/chat
 *
 * Non-streaming chat endpoint with MCP tool execution loop.
 * Saves intermediate tool turns to Firestore for real-time client observation.
 *
 * Body: { message: string }
 * Response: { turnId, agentText, artifact?, toolCalls: ToolCallSummary[] }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  if (!validateApiKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId } = await params;
  const { coworkSessionRepo, instanceRepo } = getPlatformServices();

  const session = await coworkSessionRepo.getById(sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  if (session.status !== 'active') {
    return NextResponse.json(
      { error: `Cannot message a ${session.status} session` },
      { status: 409 },
    );
  }

  const body = (await req.json()) as { message?: string };
  const humanMessage = body.message;

  if (!humanMessage || typeof humanMessage !== 'string' || humanMessage.trim().length === 0) {
    return NextResponse.json({ error: 'message string required' }, { status: 400 });
  }

  // Save human turn
  const humanTurnId = crypto.randomUUID();
  await coworkSessionRepo.addTurn(sessionId, {
    id: humanTurnId,
    role: 'human',
    content: humanMessage,
    timestamp: new Date().toISOString(),
    artifactDelta: null,
  });

  // Reload session with updated turns
  const updatedSession = (await coworkSessionRepo.getById(sessionId))!;

  // Load step context from process instance variables
  let stepContext: Record<string, unknown> | undefined;
  const instance = await instanceRepo.getById(session.processInstanceId);
  if (instance) {
    stepContext = instance.variables as Record<string, unknown>;
  }

  // Connect to MCP servers if configured
  let mcpManager: McpClientManager | null = null;
  let mcpTools: McpToolDefinition[] = [];

  if (session.mcpServers && session.mcpServers.length > 0) {
    mcpManager = new McpClientManager(session.mcpServers);
    try {
      mcpTools = await mcpManager.connect();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `Failed to connect to MCP servers: ${message}` },
        { status: 502 },
      );
    }
  }

  try {
    // Build messages
    const messages = buildMessages(updatedSession, humanMessage, stepContext);

    // Add MCP server info to system prompt if tools are available
    if (mcpTools.length > 0 && session.mcpServers) {
      const serverNames = session.mcpServers.map((s) => s.name);
      messages[0].content += buildMcpSystemPromptSection(serverNames);
    }

    const model = session.model ?? 'anthropic/claude-sonnet-4';
    const tools = buildToolsArray(mcpTools);
    const toolCallSummaries: ToolCallSummary[] = [];
    let artifact: Record<string, unknown> | undefined;
    let agentText = '';

    // Tool execution loop
    for (let iteration = 0; iteration < MAX_TOOL_LOOP_ITERATIONS; iteration++) {
      const response = await callOpenRouter(model, messages, tools);

      agentText = response.content;

      // Separate update_artifact calls from MCP tool calls
      const artifactCalls = response.toolCalls.filter((tc) => tc.function.name === 'update_artifact');
      const mcpCalls = response.toolCalls.filter((tc) => tc.function.name !== 'update_artifact');

      // Handle update_artifact
      for (const toolCall of artifactCalls) {
        try {
          const parsed = JSON.parse(toolCall.function.arguments) as { artifact: Record<string, unknown> };
          artifact = parsed.artifact;
          await coworkSessionRepo.updateArtifact(sessionId, artifact);
        } catch {
          // Skip malformed artifact tool calls
        }
      }

      // If no MCP tool calls, we're done
      if (mcpCalls.length === 0) break;

      // Process MCP tool calls
      // Add assistant message with tool_calls to conversation
      messages.push({
        role: 'assistant',
        content: agentText,
        tool_calls: response.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      });

      for (const toolCall of mcpCalls) {
        const toolName = toolCall.function.name;
        const separatorIndex = toolName.indexOf('__');
        const serverName = separatorIndex > 0 ? toolName.slice(0, separatorIndex) : 'unknown';

        let toolArgs: Record<string, unknown> = {};
        try {
          toolArgs = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
        } catch {
          // Use empty args if parsing fails
        }

        // Write running turn
        const runningTurnId = crypto.randomUUID();
        await coworkSessionRepo.addTurn(sessionId, {
          id: runningTurnId,
          role: 'tool',
          content: '',
          timestamp: new Date().toISOString(),
          artifactDelta: null,
          toolName,
          toolArgs,
          toolStatus: 'running',
          serverName,
        });

        // Execute tool
        const result = await mcpManager!.callTool(toolName, toolArgs);

        // Write result turn
        const resultTurnId = `${runningTurnId}-result`;
        await coworkSessionRepo.addTurn(sessionId, {
          id: resultTurnId,
          role: 'tool',
          content: '',
          timestamp: new Date().toISOString(),
          artifactDelta: null,
          toolName,
          toolArgs,
          toolResult: result.content,
          toolStatus: result.isError ? 'error' : 'success',
          serverName,
        });

        toolCallSummaries.push({
          name: toolName,
          serverName,
          status: result.isError ? 'error' : 'success',
        });

        // Inject tool result into conversation for next LLM call
        messages.push({
          role: 'tool',
          content: result.content,
          tool_call_id: toolCall.id,
        });
      }

      // Continue loop — the LLM will see the tool results and can make more calls
    }

    // Save final agent turn
    const agentTurnId = crypto.randomUUID();
    await coworkSessionRepo.addTurn(sessionId, {
      id: agentTurnId,
      role: 'agent',
      content: agentText,
      timestamp: new Date().toISOString(),
      artifactDelta: artifact ?? null,
    });

    return NextResponse.json({
      turnId: agentTurnId,
      agentText,
      artifact,
      toolCalls: toolCallSummaries,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (mcpManager) {
      await mcpManager.disconnect().catch(() => {});
    }
  }
}
