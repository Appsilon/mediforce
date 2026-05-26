import type { ConversationTurn } from '@mediforce/platform-core';
import { HandlerError, PreconditionFailedError } from '../../errors.js';
import { loadOr404 } from '../_helpers.js';
import type { CallerScope } from '../../repositories/index.js';
import type {
  SynthesizeVoiceArtifactInput,
  SynthesizeVoiceArtifactOutput,
} from '../../contract/cowork.js';

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

/**
 * Convert a completed voice transcript into a structured artifact and
 * persist the parsed conversation turns onto the session. Single blocking
 * JSON-mode LLM call; OpenRouter key comes from workspace + workflow
 * secrets.
 */
export async function synthesizeVoiceArtifact(
  input: SynthesizeVoiceArtifactInput,
  scope: CallerScope,
): Promise<SynthesizeVoiceArtifactOutput> {
  const session = await loadOr404(
    scope.coworkSessions.getById(input.sessionId),
    `Cowork session '${input.sessionId}' not found`,
  );

  if (session.status !== 'active') {
    throw new PreconditionFailedError(
      `Cannot synthesize for a ${session.status} session`,
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
  const openRouterApiKey = { ...nsSecrets, ...wfSecrets }['OPENROUTER_API_KEY'];
  if (!openRouterApiKey) {
    throw new HandlerError(
      'validation',
      'OPENROUTER_API_KEY not configured in workspace secrets',
    );
  }

  const model = session.voiceConfig?.synthesisModel ?? 'anthropic/claude-sonnet-4';

  const schemaBlock = session.outputSchema
    ? `\n\nTarget JSON schema:\n${JSON.stringify(session.outputSchema, null, 2)}`
    : '';
  const commentBlock = input.comment
    ? `\n\nAdditional instructions from the user:\n${input.comment}`
    : '';

  const messages = [
    {
      role: 'system' as const,
      content:
        SYNTHESIS_SYSTEM_PROMPT + schemaBlock +
        '\n\nReturn ONLY valid JSON matching the schema. No markdown fences, no explanation.',
    },
    {
      role: 'user' as const,
      content: `Voice conversation transcript:\n\n${input.transcript}${commentBlock}`,
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
    throw new HandlerError('internal', `Model API error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content?: string | null } }>;
  };
  const rawContent = data.choices?.[0]?.message?.content ?? '';

  let artifact: Record<string, unknown>;
  try {
    artifact = JSON.parse(rawContent) as Record<string, unknown>;
  } catch {
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new HandlerError('internal', 'Model response did not contain valid JSON');
    }
    try {
      artifact = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    } catch {
      throw new HandlerError('internal', 'Failed to parse JSON from model response');
    }
  }

  await scope.coworkSessions.updateArtifact(input.sessionId, artifact);

  const turns = parseTranscriptTurns(input.transcript);
  for (const turn of turns) {
    await scope.coworkSessions.addTurn(input.sessionId, turn);
  }

  return { artifact };
}

/**
 * Parse a voice transcript ("User: ...\nAgent: ...") into ConversationTurns.
 * Lines that do not start with `User:` or `Agent:` are appended to the
 * current accumulator so multi-line utterances stay together.
 */
function parseTranscriptTurns(transcript: string): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  const now = new Date().toISOString();
  let currentRole: 'human' | 'agent' | null = null;
  let currentContent = '';

  const flush = () => {
    if (currentRole !== null && currentContent.trim().length > 0) {
      turns.push({
        id: crypto.randomUUID(),
        role: currentRole,
        content: currentContent.trim(),
        timestamp: now,
        artifactDelta: null,
      });
    }
  };

  for (const line of transcript.split('\n')) {
    const userMatch = line.match(/^User:\s*(.*)/);
    const agentMatch = line.match(/^Agent:\s*(.*)/);

    if (userMatch) {
      flush();
      currentRole = 'human';
      currentContent = userMatch[1] ?? '';
    } else if (agentMatch) {
      flush();
      currentRole = 'agent';
      currentContent = agentMatch[1] ?? '';
    } else if (currentRole !== null) {
      currentContent += '\n' + line;
    }
  }
  flush();

  return turns;
}
