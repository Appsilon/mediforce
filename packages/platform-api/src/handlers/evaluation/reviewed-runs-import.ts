import type { z } from 'zod';
import type { EvalCase } from '@mediforce/platform-core';
import {
  CreateEvalCaseFromAgentRunInputSchema,
  type ImportReviewedRunsInputSchema,
  type ImportReviewedRunsOutput,
  type ListReviewedRunsInputSchema,
  type ListReviewedRunsOutput,
} from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { ValidationError } from '../../errors';
import { loadEvaluationSubject } from './_lib/evaluation-subject';
import { excludeImported, listReviewedRuns, splitSessions, type ReviewedRunCandidate, type ReviewedRunFilters } from './_lib/reviewed-runs';
import { createEvalCaseFromAgentRun } from './eval-cases';

function filtersOf(input: { verdict?: 'sentBack' | 'approved'; definitionVersion?: number; since?: string; until?: string }): ReviewedRunFilters {
  return { outcome: input.verdict, definitionVersion: input.definitionVersion, since: input.since, until: input.until };
}

function candidateView(candidate: ReviewedRunCandidate) {
  return {
    agentRunId: candidate.agentRun.id,
    outcome: candidate.outcome,
    startedAt: candidate.agentRun.startedAt,
    definitionVersion: candidate.definitionVersion,
  };
}

/** A subject's reviewed production runs — sent back or approved — not yet an Eval Case (ADR-0024 D7). */
export async function listReviewedRunsForImport(
  input: z.output<typeof ListReviewedRunsInputSchema>,
  scope: CallerScope,
): Promise<ListReviewedRunsOutput> {
  const { subject } = await loadEvaluationSubject(scope, input, 'read');
  const candidates = await excludeImported(scope, subject, await listReviewedRuns(scope, subject, filtersOf(input)));
  return { runs: candidates.map(candidateView) };
}

/**
 * Turns the subject's reviewed production runs into Eval Cases in bulk
 * (ADR-0024 D7), reusing `createEvalCaseFromAgentRun`'s labelling for each
 * one. A run round already imported is skipped; the rest split dev/holdout
 * by review session, so every round of one review lands on the same side.
 */
export async function importReviewedRuns(
  input: z.output<typeof ImportReviewedRunsInputSchema>,
  scope: CallerScope,
): Promise<ImportReviewedRunsOutput> {
  const { subject } = await loadEvaluationSubject(scope, input, 'edit');
  const matching = await listReviewedRuns(scope, subject, filtersOf(input));
  const awaitingImport = await excludeImported(scope, subject, matching);

  const chosen = input.agentRunIds === undefined
    ? awaitingImport
    : awaitingImport.filter((candidate) => input.agentRunIds!.includes(candidate.agentRun.id));
  if (input.agentRunIds !== undefined) {
    const found = new Set(chosen.map((candidate) => candidate.agentRun.id));
    const unknown = input.agentRunIds.filter((agentRunId) => !found.has(agentRunId));
    if (unknown.length > 0) throw new ValidationError(`Not a reviewed run awaiting import: ${unknown.join(', ')}`);
  }

  const split = splitSessions(chosen);
  const imported: EvalCase[] = [];
  for (const candidate of chosen) {
    const { evalCase } = await createEvalCaseFromAgentRun(CreateEvalCaseFromAgentRunInputSchema.parse({
      agentRunId: candidate.agentRun.id,
      ...(subject.kind === 'agent'
        ? { agent: { namespace: subject.namespace, agentId: subject.agentId } }
        : { step: { namespace: subject.namespace, workflowName: subject.workflowName, stepId: subject.stepId } }),
      split: split.get(candidate.sessionId) ?? 'dev',
      origin: input.origin,
    }), scope);
    imported.push(evalCase);
  }
  return { imported, skipped: matching.length - awaitingImport.length };
}
