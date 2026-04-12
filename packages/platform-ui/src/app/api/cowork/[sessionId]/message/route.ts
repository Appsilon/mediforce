import { NextRequest } from 'next/server';
import { getPlatformServices, validateApiKey } from '@/lib/platform-services';
import { buildMessages, ARTIFACT_TOOL } from '@/lib/cowork/build-messages';

/**
 * POST /api/cowork/:sessionId/message
 *
 * Sends a human message to the cowork session, streams the model response via SSE.
 *
 * Body: { message: string }
 *
 * SSE events:
 *   data: { type: "text_delta", content: string }
 *   data: { type: "artifact_update", artifact: object }
 *   data: { type: "done", turnId: string }
 *   data: { type: "error", message: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  if (!validateApiKey(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { sessionId } = await params;
  const { coworkSessionRepo, instanceRepo } = getPlatformServices();

  const session = await coworkSessionRepo.getById(sessionId);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Session not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (session.status !== 'active') {
    return new Response(
      JSON.stringify({ error: `Cannot message a ${session.status} session` }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const body = (await req.json()) as { message?: string };
  const humanMessage = body.message;

  if (!humanMessage || typeof humanMessage !== 'string' || humanMessage.trim().length === 0) {
    return new Response(JSON.stringify({ error: 'message string required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Load step context from process instance variables (previous step output)
  let stepContext: Record<string, unknown> | undefined;
  const instance = await instanceRepo.getById(session.processInstanceId);
  if (instance) {
    stepContext = instance.variables as Record<string, unknown>;
  }

  // Save human turn immediately
  const humanTurnId = crypto.randomUUID();
  await coworkSessionRepo.addTurn(sessionId, {
    id: humanTurnId,
    role: 'human',
    content: humanMessage,
    timestamp: new Date().toISOString(),
    artifactDelta: null,
  });

  // Reload session to get updated turns
  const updatedSession = (await coworkSessionRepo.getById(sessionId))!;

  // Build messages for the model
  const messages = buildMessages(updatedSession, humanMessage, stepContext);
  const model = session.model ?? 'anthropic/claude-sonnet-4';

  // Stream from OpenRouter
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const openRouterResponse = await fetch(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? process.env.DOCKER_OPENROUTER_API_KEY ?? ''}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              messages,
              tools: [ARTIFACT_TOOL],
              stream: true,
              temperature: 0.7,
              max_tokens: 4096,
            }),
          },
        );

        if (!openRouterResponse.ok) {
          const errorText = await openRouterResponse.text();
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'error', message: `Model API error ${openRouterResponse.status}: ${errorText}` })}\n\n`,
            ),
          );
          controller.close();
          return;
        }

        const reader = openRouterResponse.body?.getReader();
        if (!reader) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'error', message: 'No response body from model API' })}\n\n`,
            ),
          );
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';
        let toolCallArgs = '';
        let hasToolCall = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
              const chunk = JSON.parse(data) as {
                choices: Array<{
                  delta: {
                    content?: string | null;
                    tool_calls?: Array<{
                      function?: { name?: string; arguments?: string };
                    }>;
                  };
                  finish_reason?: string | null;
                }>;
              };

              const delta = chunk.choices?.[0]?.delta;
              if (!delta) continue;

              // Text content
              if (delta.content) {
                fullText += delta.content;
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: 'text_delta', content: delta.content })}\n\n`,
                  ),
                );
              }

              // Tool call (update_artifact)
              if (delta.tool_calls?.[0]?.function?.arguments) {
                hasToolCall = true;
                toolCallArgs += delta.tool_calls[0].function.arguments;
              }
            } catch {
              // Skip malformed chunks
            }
          }
        }

        // Process completed tool call: update artifact
        let artifactDelta: Record<string, unknown> | null = null;
        if (hasToolCall && toolCallArgs.length > 0) {
          try {
            const parsed = JSON.parse(toolCallArgs) as { artifact: Record<string, unknown> | string };
            // Model sometimes returns artifact as JSON string — parse it
            let rawArtifact = parsed.artifact;
            if (typeof rawArtifact === 'string') {
              rawArtifact = JSON.parse(rawArtifact) as Record<string, unknown>;
            }
            artifactDelta = typeof rawArtifact === 'object' && rawArtifact !== null
              ? rawArtifact as Record<string, unknown>
              : null;

            if (artifactDelta) {
              await coworkSessionRepo.updateArtifact(sessionId, artifactDelta);
            }

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: 'artifact_update', artifact: artifactDelta })}\n\n`,
              ),
            );
          } catch {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: 'error', message: 'Failed to parse artifact from model response' })}\n\n`,
              ),
            );
          }
        }

        // Save agent turn
        const agentTurnId = crypto.randomUUID();
        await coworkSessionRepo.addTurn(sessionId, {
          id: agentTurnId,
          role: 'agent',
          content: fullText,
          timestamp: new Date().toISOString(),
          artifactDelta,
        });

        // Done event
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'done', turnId: agentTurnId })}\n\n`,
          ),
        );

        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'error', message })}\n\n`,
          ),
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
