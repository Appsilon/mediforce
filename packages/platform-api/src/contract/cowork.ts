import { z } from 'zod';
import { ConversationTurnSchema, CoworkSessionSchema, CoworkSessionStatusSchema } from '@mediforce/platform-core';

/**
 * Contracts for the `cowork` domain.
 *
 * Reads (`get`, `getByInstance`) return `CoworkSessionSchema` bare. Mutations
 * use small, purpose-built output shapes. Missing sessions surface as
 * `NotFoundError`; forbidden access (cross-workspace) collapses to the same
 * 404 for anti-enumeration. Namespace gating happens inside the handler via
 * the parent process instance's namespace.
 */

// ---- GET /api/cowork --------------------------------------------------------
//
// List cowork sessions visible to the caller. Workspace gating is enforced by
// the `scope.coworkSessions` wrapper: api-key callers see every session, user
// callers only see sessions whose parent run belongs to a workspace they're a
// member of.

export const ListCoworkSessionsInputSchema = z.object({
  role: z.string().min(1).optional(),
  status: z.array(CoworkSessionStatusSchema).min(1).optional(),
});

export const ListCoworkSessionsOutputSchema = z.object({
  sessions: z.array(CoworkSessionSchema),
});

export type ListCoworkSessionsInput = z.infer<typeof ListCoworkSessionsInputSchema>;
export type ListCoworkSessionsOutput = z.infer<typeof ListCoworkSessionsOutputSchema>;

// ---- GET /api/cowork/:sessionId ---------------------------------------------

export const GetCoworkSessionInputSchema = z.object({
  sessionId: z.string().min(1),
});

export const GetCoworkSessionOutputSchema = CoworkSessionSchema;

export type GetCoworkSessionInput = z.infer<typeof GetCoworkSessionInputSchema>;
export type GetCoworkSessionOutput = z.infer<typeof GetCoworkSessionOutputSchema>;

// ---- GET /api/cowork/by-instance/:instanceId --------------------------------

export const GetCoworkSessionByInstanceInputSchema = z.object({
  instanceId: z.string().min(1),
});

export const GetCoworkSessionByInstanceOutputSchema = CoworkSessionSchema;

export type GetCoworkSessionByInstanceInput = z.infer<typeof GetCoworkSessionByInstanceInputSchema>;
export type GetCoworkSessionByInstanceOutput = z.infer<typeof GetCoworkSessionByInstanceOutputSchema>;

// ---- POST /api/cowork/:sessionId/chat ---------------------------------------
//
// Non-streaming turn — runs the MCP tool loop server-side and returns the
// final agent text plus optional artifact, the post-mutation session, and
// the full turns array (server's final shape). Intermediate tool turns are
// persisted to the session as they execute so polling consumers observe
// progress; the additive `session` + `turns` fields let the UI replace
// optimistic state with server truth in one round trip.

export const ChatCoworkSessionInputSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().trim().min(1, 'message string required'),
});

export const ChatCoworkToolCallSchema = z.object({
  name: z.string(),
  serverName: z.string(),
  status: z.enum(['success', 'error']),
});

export const ChatCoworkSessionOutputSchema = z.object({
  turnId: z.string(),
  agentText: z.string(),
  artifact: z.record(z.string(), z.unknown()).optional(),
  toolCalls: z.array(ChatCoworkToolCallSchema),
  session: CoworkSessionSchema,
  turns: z.array(ConversationTurnSchema),
});

export type ChatCoworkSessionInput = z.infer<typeof ChatCoworkSessionInputSchema>;
export type ChatCoworkSessionOutput = z.infer<typeof ChatCoworkSessionOutputSchema>;
export type ChatCoworkToolCall = z.infer<typeof ChatCoworkToolCallSchema>;

// ---- POST /api/cowork/:sessionId/finalize -----------------------------------
//
// Atomically (best-effort): marks the session finalized, audit-emits
// `cowork.session.finalized`, resumes the paused instance, advances the
// engine with the artifact as step output, and kicks the run via
// `scope.system.runKicker`. Multi-repo transactionality is inherited
// best-effort; the transactional version is tracked in
// https://github.com/Appsilon/mediforce/issues/516.

export const FinalizeCoworkSessionInputSchema = z.object({
  sessionId: z.string().min(1),
  artifact: z.record(z.string(), z.unknown()),
});

export const FinalizeCoworkSessionOutputSchema = z.object({
  sessionId: z.string(),
  resolvedStepId: z.string(),
  processInstanceId: z.string(),
  nextStepId: z.string().nullable(),
  status: z.string(),
});

export type FinalizeCoworkSessionInput = z.infer<typeof FinalizeCoworkSessionInputSchema>;
export type FinalizeCoworkSessionOutput = z.infer<typeof FinalizeCoworkSessionOutputSchema>;

// ---- POST /api/cowork/:sessionId/voice/ephemeral-key ------------------------
//
// Mints an OpenAI Realtime ephemeral key for direct WebRTC connection from
// the browser. Platform is not involved during the conversation; the key
// is one-shot and short-lived. Only valid for `agent === 'voice-realtime'`
// sessions.

export const CreateVoiceEphemeralKeyInputSchema = z.object({
  sessionId: z.string().min(1),
});

export const CreateVoiceEphemeralKeyOutputSchema = z.object({
  ephemeralKey: z.string(),
  model: z.string(),
});

export type CreateVoiceEphemeralKeyInput = z.infer<typeof CreateVoiceEphemeralKeyInputSchema>;
export type CreateVoiceEphemeralKeyOutput = z.infer<typeof CreateVoiceEphemeralKeyOutputSchema>;

// ---- POST /api/cowork/:sessionId/voice/synthesize ---------------------------
//
// Converts a completed voice transcript into a structured artifact and
// persists the parsed conversation turns. Single blocking JSON-mode LLM call.

export const SynthesizeVoiceArtifactInputSchema = z.object({
  sessionId: z.string().min(1),
  transcript: z.string().min(1),
  comment: z.string().optional(),
});

export const SynthesizeVoiceArtifactOutputSchema = z.object({
  artifact: z.record(z.string(), z.unknown()),
});

export type SynthesizeVoiceArtifactInput = z.infer<typeof SynthesizeVoiceArtifactInputSchema>;
export type SynthesizeVoiceArtifactOutput = z.infer<typeof SynthesizeVoiceArtifactOutputSchema>;
