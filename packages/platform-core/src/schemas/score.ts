import { z } from 'zod';

/**
 * A Score is an external quality judgment on one Agent Run or one Workflow Run
 * (ADR-0023, shape from `docs/research/layer2-scores-research.md` § 6). It is
 * never the agent's own `confidence`. Append-only: a revised judgment is a new
 * Score whose `supersedes` names the one it replaces.
 */
export const ScoreSubjectSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('agent_run'), id: z.string().min(1) }),
  z.object({ type: z.literal('workflow_run'), id: z.string().min(1) }),
]);

/** Who judged: a person, an LLM judge, or a deterministic check. */
export const ScoreSourceSchema = z.enum(['human', 'llm_judge', 'deterministic']);

export const ScoreSchema = z.object({
  id: z.uuid(),
  subject: ScoreSubjectSchema,
  /** What was judged, e.g. `human_verdict`, `has_result`, an Evaluator's name. */
  name: z.string().min(1),
  /** Normalised to 0–1 so Scores aggregate across vocabularies. */
  value: z.number().min(0).max(1),
  /** The categorical judgment as given, e.g. the verdict key `approve`. */
  label: z.string().nullable(),
  /** The judge's reasoning. */
  comment: z.string().nullable(),
  source: ScoreSourceSchema,
  /** User id for `human`; null for automated sources. */
  createdBy: z.string().nullable(),
  /** Source-specific detail, e.g. `{ verdictKey, intent }` or `{ judgeModel, rubric }`. */
  metadata: z.record(z.string(), z.unknown()).nullable(),
  namespace: z.string().min(1),
  processInstanceId: z.string().nullable(),
  stepId: z.string().nullable(),
  /** The Evaluator that produced it; null for Scores no Evaluator owns (human verdicts). */
  evaluatorId: z.string().nullable(),
  supersedes: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});

export type ScoreSubject = z.infer<typeof ScoreSubjectSchema>;
export type ScoreSource = z.infer<typeof ScoreSourceSchema>;
export type Score = z.infer<typeof ScoreSchema>;
