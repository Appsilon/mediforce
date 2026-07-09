import { HandlerError, PreconditionFailedError } from '../../errors';
import { loadOr404 } from '../_helpers';
import type { CallerScope } from '../../repositories/index';
import type {
  CreateVoiceEphemeralKeyInput,
  CreateVoiceEphemeralKeyOutput,
} from '../../contract/cowork';

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

/**
 * Mint an OpenAI Realtime API ephemeral key for a voice-realtime cowork
 * session. The browser then opens a WebRTC connection directly to OpenAI;
 * the platform is not involved during the conversation itself.
 */
export async function createVoiceEphemeralKey(
  input: CreateVoiceEphemeralKeyInput,
  scope: CallerScope,
): Promise<CreateVoiceEphemeralKeyOutput> {
  const session = await loadOr404(
    scope.coworkSessions.getById(input.sessionId),
    `Cowork session '${input.sessionId}' not found`,
  );

  if (session.status !== 'active') {
    throw new PreconditionFailedError(
      `Cannot create key for a ${session.status} session`,
      { sessionId: input.sessionId, status: session.status },
    );
  }

  if (session.agent !== 'voice-realtime') {
    throw new HandlerError('validation', 'Session is not a voice-realtime session');
  }

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new HandlerError('validation', 'OPENAI_API_KEY is not configured');
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
    throw new HandlerError('internal', `OpenAI API error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as {
    client_secret: { value: string };
    model: string;
  };

  return {
    ephemeralKey: data.client_secret.value,
    model: data.model,
  };
}
