import type { Score, ScoreSource } from '../schemas/score';

/** Narrowing filters for `ScoreRepository.list*`; every set field must match. */
export interface ListScoresFilter {
  readonly agentRunId?: string;
  readonly processInstanceId?: string;
  readonly stepId?: string;
  readonly name?: string;
  readonly evaluatorId?: string;
  readonly source?: ScoreSource;
  readonly namespace?: string;
  readonly limit: number;
}

/**
 * Scores (ADR-0023), newest first. Append-only by design — there is no update
 * or delete; a correction is a new Score that `supersedes` the old one.
 */
export interface ScoreRepository {
  create(score: Score): Promise<Score>;
  list(filter: ListScoresFilter): Promise<Score[]>;
  listInNamespaces(allowed: readonly string[], filter: ListScoresFilter): Promise<Score[]>;
}
