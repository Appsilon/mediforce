'use server';

import { getPlatformServices, getAppBaseUrl } from '@/lib/platform-services';
import type { ConversationTurn } from '@mediforce/platform-core';

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
  const { getAppBaseUrl } = await import('@/lib/platform-services');
  const appUrl = getAppBaseUrl();

  const response = await fetch(`${appUrl}/api/cowork/${sessionId}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': process.env.PLATFORM_API_KEY ?? '',
    },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    return { success: false, error: data.error ?? `API error ${response.status}` };
  }

  const data = (await response.json()) as {
    turnId: string;
    agentText: string;
    artifact?: Record<string, unknown>;
  };

  return {
    success: true,
    agentText: data.agentText,
    artifact: data.artifact,
    turnId: data.turnId,
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

// ---------------------------------------------------------------------------
// createVoiceEphemeralKey — get OpenAI Realtime API ephemeral key
// ---------------------------------------------------------------------------

const DEFAULT_VOICE_INSTRUCTIONS =
  'You are a collaborative assistant. Help the user design and discuss their requirements through voice conversation. ' +
  'Keep responses concise and conversational — you are speaking, not writing. ' +
  'Ask clarifying questions to understand their needs. ' +
  'When you have enough information to draft or update the artifact, call update_artifact with your current best version.';

const VOICE_ARTIFACT_TOOL = {
  type: 'function' as const,
  name: 'update_artifact',
  description:
    'Update the current artifact with your latest draft. Call whenever you have enough information ' +
    'to create or revise the artifact. Always send the COMPLETE object, not a partial update.',
  parameters: {
    type: 'object',
    properties: {
      artifact: {
        type: 'object',
        description: 'The complete updated artifact object',
      },
    },
    required: ['artifact'],
  },
};

export interface VoiceEphemeralKeyResult {
  success: boolean;
  ephemeralKey?: string;
  model?: string;
  error?: string;
}

export async function createVoiceEphemeralKey(
  sessionId: string,
): Promise<VoiceEphemeralKeyResult> {
  const { coworkSessionRepo } = getPlatformServices();

  const session = await coworkSessionRepo.getById(sessionId);
  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  if (session.status !== 'active') {
    return { success: false, error: `Cannot create key for a ${session.status} session` };
  }

  if (session.agent !== 'voice-realtime') {
    return { success: false, error: 'Session is not a voice-realtime session' };
  }

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    return { success: false, error: 'OPENAI_API_KEY is not configured' };
  }

  const model = session.model ?? 'gpt-4o-realtime-preview';

  const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      voice: session.voiceConfig?.voice ?? 'alloy',
      instructions: session.systemPrompt ?? DEFAULT_VOICE_INSTRUCTIONS,
      tools: [VOICE_ARTIFACT_TOOL],
      input_audio_transcription: { model: 'whisper-1' },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return { success: false, error: `OpenAI API error ${response.status}: ${errorText}` };
  }

  const data = (await response.json()) as {
    client_secret: { value: string };
    model: string;
  };

  return {
    success: true,
    ephemeralKey: data.client_secret.value,
    model: data.model,
  };
}

// ---------------------------------------------------------------------------
// synthesizeArtifact — convert voice transcript into structured artifact
// ---------------------------------------------------------------------------

export interface SynthesizeArtifactResult {
  success: boolean;
  artifact?: Record<string, unknown>;
  error?: string;
}

export async function synthesizeArtifact(
  sessionId: string,
  transcript: string,
  comment?: string,
): Promise<SynthesizeArtifactResult> {
  const { coworkSessionRepo } = getPlatformServices();

  const session = await coworkSessionRepo.getById(sessionId);
  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  if (session.status !== 'active') {
    return { success: false, error: `Cannot synthesize for a ${session.status} session` };
  }

  const model = session.voiceConfig?.synthesisModel ?? 'anthropic/claude-sonnet-4';

  const openRouterApiKey = process.env.OPENROUTER_API_KEY ?? process.env.DOCKER_OPENROUTER_API_KEY;
  if (!openRouterApiKey) {
    return { success: false, error: 'OPENROUTER_API_KEY is not configured' };
  }

  const schemaBlock = session.outputSchema
    ? `\n\nTarget JSON schema:\n${JSON.stringify(session.outputSchema, null, 2)}`
    : '';

  const commentBlock = comment
    ? `\n\nAdditional instructions from the user:\n${comment}`
    : '';

  const messages = [
    {
      role: 'system' as const,
      content: SYNTHESIS_SYSTEM_PROMPT + schemaBlock +
        '\n\nReturn ONLY valid JSON matching the schema. No markdown fences, no explanation.',
    },
    {
      role: 'user' as const,
      content: `Voice conversation transcript:\n\n${transcript}${commentBlock}`,
    },
  ];

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openRouterApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return { success: false, error: `Model API error ${response.status}: ${errorText}` };
  }

  const data = (await response.json()) as {
    choices: Array<{
      message: { content?: string | null };
    }>;
  };

  const rawContent = data.choices?.[0]?.message?.content ?? '';

  // Parse JSON — try direct parse, then regex extract
  let artifact: Record<string, unknown>;
  try {
    artifact = JSON.parse(rawContent) as Record<string, unknown>;
  } catch {
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, error: 'Model response did not contain valid JSON' };
    }
    try {
      artifact = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    } catch {
      return { success: false, error: 'Failed to parse JSON from model response' };
    }
  }

  // Save artifact
  await coworkSessionRepo.updateArtifact(sessionId, artifact);

  // Parse transcript into conversation turns and save
  const turnLines = transcript.split('\n');
  let currentRole: 'human' | 'agent' | null = null;
  let currentContent = '';
  const turns: ConversationTurn[] = [];
  const now = new Date().toISOString();

  for (const line of turnLines) {
    const userMatch = line.match(/^User:\s*(.*)/);
    const agentMatch = line.match(/^Agent:\s*(.*)/);

    if (userMatch) {
      if (currentRole !== null && currentContent.trim().length > 0) {
        turns.push({
          id: crypto.randomUUID(),
          role: currentRole,
          content: currentContent.trim(),
          timestamp: now,
          artifactDelta: null,
        });
      }
      currentRole = 'human';
      currentContent = userMatch[1] ?? '';
    } else if (agentMatch) {
      if (currentRole !== null && currentContent.trim().length > 0) {
        turns.push({
          id: crypto.randomUUID(),
          role: currentRole,
          content: currentContent.trim(),
          timestamp: now,
          artifactDelta: null,
        });
      }
      currentRole = 'agent';
      currentContent = agentMatch[1] ?? '';
    } else if (currentRole !== null) {
      currentContent += '\n' + line;
    }
  }

  // Flush last accumulated turn
  if (currentRole !== null && currentContent.trim().length > 0) {
    turns.push({
      id: crypto.randomUUID(),
      role: currentRole,
      content: currentContent.trim(),
      timestamp: now,
      artifactDelta: null,
    });
  }

  for (const turn of turns) {
    await coworkSessionRepo.addTurn(sessionId, turn);
  }

  return { success: true, artifact };
}

// ---------------------------------------------------------------------------
// Synthesis prompt — detailed to produce high-quality WorkflowDefinitions
// ---------------------------------------------------------------------------

const SYNTHESIS_SYSTEM_PROMPT = `You are an expert Mediforce workflow synthesizer. Given a voice conversation transcript, produce a complete, detailed WorkflowDefinition JSON.

## WorkflowDefinition structure

{
  "name": "kebab-case-name",
  "version": 1,
  "description": "What this workflow does",
  "triggers": [{ "type": "manual", "name": "Start" }],
  "roles": ["role1", "role2"],
  "steps": [
    {
      "id": "kebab-case-id",
      "name": "Human Readable Name",
      "type": "creation|review|decision|terminal",
      "executor": "human|agent|script|cowork",
      "description": "Detailed description of what this step does",
      "allowedRoles": ["role1"],
      "autonomyLevel": "L0|L1|L2|L3|L4",
      "plugin": "claude-code-agent|opencode-agent|script-container"
    }
  ],
  "transitions": [
    { "from": "step-a", "to": "step-b" },
    { "from": "step-a", "to": "step-c", "when": "output.field == value" }
  ]
}

## Rules you MUST follow

1. Every step MUST have: id, name, type, executor, description
2. Every workflow MUST have at least one terminal step (type: "terminal")
3. Executor types:
   - "human" — manual work (forms, uploads, approvals)
   - "agent" — AI-powered (add plugin + autonomyLevel)
   - "script" — deterministic code (validation, API calls, notifications)
   - "cowork" — collaborative human+AI artifact construction
4. Autonomy levels (required for agent steps):
   - L0: human only, L1: agent suggests, L2: agent acts + human approves,
   - L3: agent acts + periodic review, L4: fully autonomous
5. Plugins for agent/script steps: claude-code-agent, opencode-agent, script-container
6. Use kebab-case for all IDs and the workflow name
7. Review steps use "verdicts" map, non-review steps use "transitions" array
8. If a step has multiple outgoing transitions, each MUST have a "when" expression
9. Infer roles from the conversation context — who is performing each step?
10. Be specific in descriptions — don't leave them vague

## What to infer when the conversation is vague

- If the user mentions "checking" or "validating" → likely a script step with L4
- If "review" or "approval" → human step or agent with L2/L3
- If "AI does X" or "automatically" → agent step with appropriate autonomy
- If "send notification" or "webhook" → script step
- Default trigger: manual, unless they mention scheduling or webhooks`;

