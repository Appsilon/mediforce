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
  // Cache-read input tokens are billed at the (much cheaper) cacheRead rate,
  // so they are tracked separately from full-price input tokens.
  cachedInputTokens: z.number().int().nonnegative().optional(),
  // Largest single-turn prompt the model held during the run. Unlike
  // `inputTokens` (summed across turns, for cost), this is the peak context
  // occupancy — divide by the model's contextLength for the saturation ratio
  // used to size agent batches. Only populated when the runner exposes
  // per-turn token counts (e.g. OpenCode step_finish events).
  peakInputTokens: z.number().int().nonnegative().optional(),
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

export const StepOutputEnvelopeSchema = z.object({
  duration_ms: z.number().int().nonnegative(),
  result: z.record(z.string(), z.unknown()).nullable(),
  annotations: z.array(AnnotationSchema),
  gitMetadata: GitMetadataSchema.nullable().optional(),
  presentation: PresentationFieldSchema.nullable().optional(),
  deliverableFile: z.string().nullable().optional(),
});

export const AgentOutputEnvelopeSchema = StepOutputEnvelopeSchema.extend({
  confidence: z.number().min(0).max(1),
  confidence_rationale: z.string().optional(),
  reasoning_summary: z.string(),
  reasoning_chain: z.array(z.string()),
  model: z.string().nullable(),
  tokenUsage: TokenUsageSchema.optional(),
});

export type Annotation = z.infer<typeof AnnotationSchema>;
export type GitMetadata = z.infer<typeof GitMetadataSchema>;
export type TokenUsage = z.infer<typeof TokenUsageSchema>;
export type Presentation = z.infer<typeof PresentationSchema>;
export type StepOutputEnvelope = z.infer<typeof StepOutputEnvelopeSchema>;
export type AgentOutputEnvelope = z.infer<typeof AgentOutputEnvelopeSchema>;
