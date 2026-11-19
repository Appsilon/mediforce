import type { AgentRun, EvaluationSubject } from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';
import { loadFirstRound, newestVerdict, sentBack } from './case-source';
import { listAgentProductionRuns } from './agent-production-runs';
import { listStepProductionAgentRunsPage } from './step-agent-runs';

export type ReviewOutcome = 'sentBack' | 'approved';
export type EvalCaseSplit = 'dev' | 'holdout';

/**
 * A reviewed production run O5 may import (ADR-0024 D7): its outcome, the
 * Definition version its step ran, and the id of the run its review started
 * from — every round of one review (sent back any number of times, then
 * approved) shares that id and so lands on the same dev/holdout side.
 */
export interface ReviewedRunCandidate {
  readonly agentRun: AgentRun;
  readonly outcome: ReviewOutcome;
  readonly definitionVersion: number | null;
  readonly sessionId: string;
}

export interface ReviewedRunFilters {
  readonly outcome?: ReviewOutcome;
  readonly definitionVersion?: number;
  readonly since?: string;
  readonly until?: string;
}

function matchesFilters(run: AgentRun, definitionVersion: number | null, outcome: ReviewOutcome, filters: ReviewedRunFilters): boolean {
  if (filters.outcome !== undefined && filters.outcome !== outcome) return false;
  if (filters.definitionVersion !== undefined && definitionVersion !== filters.definitionVersion) return false;
  if (filters.since !== undefined && run.startedAt < filters.since) return false;
  if (filters.until !== undefined && run.startedAt > filters.until) return false;
  return true;
}

/** What a person's newest verdict makes of a run for O5; null for a plain reject, a recheck, or no review — none of O5's business. */
export async function reviewOutcomeOf(scope: CallerScope, agentRunId: string): Promise<ReviewOutcome | null> {
  const verdict = await newestVerdict(scope, agentRunId);
  if (verdict === undefined) return null;
  if (sentBack(verdict)) return 'sentBack';
  return verdict.value === 1 ? 'approved' : null;
}

// shortcut: scans at most this many of the subject's newest production runs; upgrade to a cursor-exposed candidate query if a subject outgrows it.
const SCAN_LIMIT = 500;

/** The subject's finished production runs reviewed `sentBack` or `approved`, matching `filters`, newest first. */
export async function listReviewedRuns(scope: CallerScope, subject: EvaluationSubject, filters: ReviewedRunFilters): Promise<ReviewedRunCandidate[]> {
  const scanned: Array<{ run: AgentRun; definitionVersion: number | null }> = [];
  if (subject.kind === 'agent') {
    const { runs } = await listAgentProductionRuns(scope, subject, SCAN_LIMIT);
    scanned.push(...runs.map(({ agentRun, change }) => ({ run: agentRun, definitionVersion: change.definitionVersion })));
  } else {
    let cursor: string | undefined;
    do {
      const page = await listStepProductionAgentRunsPage(scope, subject, 100, cursor);
      for (const run of page.runs) {
        const instance = await scope.runs.getById(run.processInstanceId);
        scanned.push({ run, definitionVersion: instance === null ? null : Number(instance.definitionVersion) });
      }
      cursor = page.nextCursor;
    } while (cursor !== undefined && scanned.length < SCAN_LIMIT);
  }

  const candidates: ReviewedRunCandidate[] = [];
  for (const { run, definitionVersion } of scanned) {
    const outcome = await reviewOutcomeOf(scope, run.id);
    if (outcome === null || !matchesFilters(run, definitionVersion, outcome, filters)) continue;
    const firstRound = await loadFirstRound(scope, run);
    candidates.push({ agentRun: run, outcome, definitionVersion, sessionId: firstRound.id });
  }
  return candidates.sort((left, right) => right.agentRun.startedAt.localeCompare(left.agentRun.startedAt));
}

/** `candidates` with a run round already imported (an Eval Case keeps it as `sourceAgentRunId`) left out. */
export async function excludeImported(scope: CallerScope, subject: EvaluationSubject, candidates: readonly ReviewedRunCandidate[]): Promise<ReviewedRunCandidate[]> {
  const imported = new Set(
    (await scope.evaluation.listCases(subject)).flatMap((evalCase) => evalCase.sourceAgentRunId === null ? [] : [evalCase.sourceAgentRunId]),
  );
  return candidates.filter((candidate) => !imported.has(candidate.agentRun.id));
}

/**
 * Dev/holdout for each review session (ADR-0024 D7): grouped by the
 * expectation its newest round labels, ~70/30 within each group — the
 * group's newest sessions into holdout, at least one when it has more than
 * one session.
 */
export function splitSessions(candidates: readonly ReviewedRunCandidate[]): Map<string, EvalCaseSplit> {
  const sessionOutcome = new Map<string, ReviewOutcome>();
  for (const candidate of [...candidates].sort((left, right) => left.agentRun.startedAt.localeCompare(right.agentRun.startedAt))) {
    sessionOutcome.set(candidate.sessionId, candidate.outcome);
  }
  const groups = new Map<ReviewOutcome, string[]>();
  for (const [sessionId, outcome] of sessionOutcome) groups.set(outcome, [...(groups.get(outcome) ?? []), sessionId]);

  const assignment = new Map<string, EvalCaseSplit>();
  for (const sessionIds of groups.values()) {
    const holdoutCount = sessionIds.length >= 2 ? Math.max(1, Math.round(sessionIds.length * 0.3)) : 0;
    sessionIds.forEach((sessionId, index) => {
      assignment.set(sessionId, index >= sessionIds.length - holdoutCount ? 'holdout' : 'dev');
    });
  }
  return assignment;
}
