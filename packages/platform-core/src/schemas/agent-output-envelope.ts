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
  presentation: z.string().nullable().optional(), // optional HTML view for human reviewers
});

export type Annotation = z.infer<typeof AnnotationSchema>;
export type GitMetadata = z.infer<typeof GitMetadataSchema>;
export type AgentOutputEnvelope = z.infer<typeof AgentOutputEnvelopeSchema>;
