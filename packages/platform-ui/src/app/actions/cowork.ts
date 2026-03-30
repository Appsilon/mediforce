'use server';

import { getPlatformServices, getAppBaseUrl } from '@/lib/platform-services';
import { buildMessages, ARTIFACT_TOOL } from '@/lib/cowork/build-messages';

// ---------------------------------------------------------------------------
// sendMessage — streams model response, returns final result
// ---------------------------------------------------------------------------

export interface SendMessageResult {
  success: boolean;
  agentText?: string;
  artifact?: Record<string, unknown>;
  turnId?: string;
  error?: string;
}

export async function sendMessage(
  sessionId: string,
  message: string,
): Promise<SendMessageResult> {
  const { coworkSessionRepo, instanceRepo } = getPlatformServices();

  const session = await coworkSessionRepo.getById(sessionId);
  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  if (session.status !== 'active') {
    return { success: false, error: `Cannot message a ${session.status} session` };
  }

  // Save human turn
  const humanTurnId = crypto.randomUUID();
  await coworkSessionRepo.addTurn(sessionId, {
    id: humanTurnId,
    role: 'human',
    content: message,
    timestamp: new Date().toISOString(),
    artifactDelta: null,
  });

  // Reload session with updated turns
  const updatedSession = (await coworkSessionRepo.getById(sessionId))!;

  // Load step context
  let stepContext: Record<string, unknown> | undefined;
  const instance = await instanceRepo.getById(session.processInstanceId);
  if (instance) {
    stepContext = instance.variables as Record<string, unknown>;
  }

  // Build messages (without the new message since it's already in turns)
  // We pass empty string since the human turn is already in updatedSession.turns
  const messages = buildMessages(updatedSession, '', stepContext);
  // Remove the trailing empty user message that buildMessages adds
  messages.pop();

  const model = session.model ?? 'anthropic/claude-sonnet-4';

  // Call OpenRouter (non-streaming for server action simplicity)
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
        temperature: 0.7,
        max_tokens: 4096,
      }),
    },
  );

  if (!openRouterResponse.ok) {
    const errorText = await openRouterResponse.text();
    return { success: false, error: `Model API error ${openRouterResponse.status}: ${errorText}` };
  }

  const data = (await openRouterResponse.json()) as {
    choices: Array<{
      message: {
        content?: string | null;
        tool_calls?: Array<{
          function: { name: string; arguments: string };
        }>;
      };
    }>;
  };

  const choice = data.choices?.[0]?.message;
  const agentText = choice?.content ?? '';

  // Process tool calls (update_artifact)
  let artifact: Record<string, unknown> | undefined;
  if (choice?.tool_calls) {
    for (const toolCall of choice.tool_calls) {
      if (toolCall.function.name === 'update_artifact') {
        try {
          const parsed = JSON.parse(toolCall.function.arguments) as {
            artifact: Record<string, unknown>;
          };
          artifact = parsed.artifact;
          await coworkSessionRepo.updateArtifact(sessionId, artifact);
        } catch {
          // Skip malformed tool calls
        }
      }
    }
  }

  // Save agent turn
  const agentTurnId = crypto.randomUUID();
  await coworkSessionRepo.addTurn(sessionId, {
    id: agentTurnId,
    role: 'agent',
    content: agentText,
    timestamp: new Date().toISOString(),
    artifactDelta: artifact ?? null,
  });

  return {
    success: true,
    agentText,
    artifact,
    turnId: agentTurnId,
  };
}

// ---------------------------------------------------------------------------
// finalizeSession — finalize artifact, resume workflow
// ---------------------------------------------------------------------------

export interface FinalizeResult {
  success: boolean;
  nextStepId?: string | null;
  error?: string;
}

export async function finalizeSession(
  sessionId: string,
  artifact: Record<string, unknown>,
): Promise<FinalizeResult> {
  const { coworkSessionRepo, instanceRepo, auditRepo, engine } = getPlatformServices();

  const session = await coworkSessionRepo.getById(sessionId);
  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  if (session.status !== 'active') {
    return { success: false, error: `Cannot finalize a ${session.status} session` };
  }

  // Finalize
  await coworkSessionRepo.finalize(sessionId, artifact);

  const now = new Date().toISOString();
  await auditRepo.append({
    actorId: 'ui-user',
    actorType: 'user',
    actorRole: 'operator',
    action: 'cowork.session.finalized',
    description: `Cowork session '${sessionId}' finalized for step '${session.stepId}'`,
    timestamp: now,
    inputSnapshot: { sessionId, stepId: session.stepId },
    outputSnapshot: { artifactKeys: Object.keys(artifact) },
    basis: 'Cowork session finalized via UI',
    entityType: 'coworkSession',
    entityId: sessionId,
    processInstanceId: session.processInstanceId,
  });

  // Resume process
  const instance = await instanceRepo.getById(session.processInstanceId);
  if (!instance || instance.status !== 'paused') {
    return { success: false, error: 'Process instance not in paused state' };
  }

  await instanceRepo.update(session.processInstanceId, {
    status: 'running',
    pauseReason: null,
    updatedAt: now,
  });

  await engine.advanceStep(session.processInstanceId, artifact, {
    id: 'ui-user',
    role: 'human',
  });

  // Trigger auto-runner
  const appUrl = getAppBaseUrl();
  fetch(`${appUrl}/api/processes/${session.processInstanceId}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': process.env.PLATFORM_API_KEY ?? '',
    },
    body: JSON.stringify({ triggeredBy: 'cowork-finalize' }),
  }).catch(() => {});

  const updatedInstance = await instanceRepo.getById(session.processInstanceId);

  return {
    success: true,
    nextStepId: updatedInstance?.currentStepId ?? null,
  };
}
