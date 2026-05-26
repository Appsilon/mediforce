import { z } from 'zod';

export const AnnotationSchema = z.object({
  id: z.string(),
  content: z.string(),
  timestamp: z.string().datetime(),
});

export const GitMetadataSchema = z.object({
  commitSha: z.string(),
  branch: z.string(),
  changedFiles: z.array(z.string()),
  repoUrl: z.string(),
});

export const TokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});

/** A reviewer-facing preview rendered by the platform. `markdown` flows
 *  through a sanitized GFM renderer with Mediforce typography; `html`
 *  flows through the sandboxed iframe path for cases that genuinely need
 *  scripts or inline interactivity. */
export const PresentationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('markdown'), content: z.string() }),
  z.object({ kind: z.literal('html'), content: z.string() }),
]);

/** Accepts both the new discriminated shape and the legacy raw string
 *  (pre-#468 envelopes stored `presentation: "<html>..."`). Raw strings
 *  parse as `{kind: 'html', content}` so existing Firestore rows render
 *  without a migration. */
const PresentationFieldSchema = z.union([z.string(), PresentationSchema])
  .transform((value) =>
    typeof value === 'string' ? { kind: 'html' as const, content: value } : value,
  );

export const AgentOutputEnvelopeSchema = z.object({
  confidence: z.number().min(0).max(1),
  confidence_rationale: z.string().optional(),
  reasoning_summary: z.string(),
  reasoning_chain: z.array(z.string()),
  annotations: z.array(AnnotationSchema),
  model: z.string().nullable(), // null for non-LLM agents
  duration_ms: z.number().int().nonnegative(),
  result: z.record(z.string(), z.unknown()).nullable(), // nullable for L0/L2 annotations-only
  gitMetadata: GitMetadataSchema.nullable().optional(), // container execution git output
  presentation: PresentationFieldSchema.nullable().optional(),
  deliverableFile: z.string().nullable().optional(), // persisted deliverable file path
  tokenUsage: TokenUsageSchema.optional(),
});

export type Annotation = z.infer<typeof AnnotationSchema>;
export type GitMetadata = z.infer<typeof GitMetadataSchema>;
export type TokenUsage = z.infer<typeof TokenUsageSchema>;
export type Presentation = z.infer<typeof PresentationSchema>;
export type AgentOutputEnvelope = z.infer<typeof AgentOutputEnvelopeSchema>;
