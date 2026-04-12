import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices, validateApiKey } from '@/lib/platform-services';
import { buildMessages, ARTIFACT_TOOL } from '@/lib/cowork/build-messages';

/**
 * POST /api/cowork/:sessionId/chat
 *
 * Non-streaming chat endpoint. Sends a human message to the cowork session,
 * waits for the full model response, and returns JSON.
 *
 * Body: { message: string }
 *
 * Response: { agentText: string, artifact: object | null, turnId: string }
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

  // Call OpenRouter (non-streaming)
  const openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? process.env.DOCKER_OPENROUTER_API_KEY ?? ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      tools: [ARTIFACT_TOOL],
      temperature: 0.7,
      max_tokens: 4096,
    }),
  });

  if (!openRouterResponse.ok) {
    const errorText = await openRouterResponse.text();
    return NextResponse.json(
      { error: `Model API error ${openRouterResponse.status}: ${errorText}` },
      { status: 502 },
    );
  }

  const completion = (await openRouterResponse.json()) as {
    choices: Array<{
      message: {
        content?: string | null;
        tool_calls?: Array<{
          function: { name: string; arguments: string };
        }>;
      };
    }>;
  };

  const choice = completion.choices?.[0]?.message;
  const agentText = choice?.content ?? '';

  // Process tool call: update artifact
  let artifact: Record<string, unknown> | null = null;
  const toolCall = choice?.tool_calls?.find((tc) => tc.function.name === 'update_artifact');
  if (toolCall) {
    try {
      const parsed = JSON.parse(toolCall.function.arguments) as {
        artifact: Record<string, unknown> | string;
      };
      // Model sometimes returns artifact as JSON string — parse it
      let rawArtifact = parsed.artifact;
      if (typeof rawArtifact === 'string') {
        rawArtifact = JSON.parse(rawArtifact) as Record<string, unknown>;
      }
      if (typeof rawArtifact === 'object' && rawArtifact !== null) {
        artifact = rawArtifact as Record<string, unknown>;
        await coworkSessionRepo.updateArtifact(sessionId, artifact);
      }
    } catch {
      // If artifact parsing fails, continue without artifact update
    }
  }

  // Save agent turn
  const agentTurnId = crypto.randomUUID();
  await coworkSessionRepo.addTurn(sessionId, {
    id: agentTurnId,
    role: 'agent',
    content: agentText,
    timestamp: new Date().toISOString(),
    artifactDelta: artifact,
  });

  return NextResponse.json({
    agentText,
    artifact,
    turnId: agentTurnId,
  });
}
