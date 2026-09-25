import type { EvalRun, EvalRunStatus, EvalTrial, EvalTrialStatus } from '../schemas/eval-run';
import type { StepQualification } from '../schemas/step-qualification';
import type {
  AcceptanceCriteriaVersion,
  EvalCase,
  EvalDatasetVersion,
  EvaluatedStep,
  EvaluationBrief,
  Evaluator,
  EvaluatorVersion,
  JudgeCalibration,
  McpEvalPolicy,
  SourceApproval,
} from '../schemas/evaluation';

/**
 * Storage for the Evaluation domain (ADR-0023): Briefs, Evaluators and their
 * versions, Eval Cases, frozen Eval Dataset versions, MCP eval policies,
 * Acceptance Criteria, Eval Runs and Step Qualifications.
 * Every row carries its Step's namespace, so the authorized wrapper gates each
 * call on the namespace it names or the row it returns.
 *
 * Versioned rows are append-only: a Brief, Acceptance Criteria or Evaluator
 * change is a new version, and the only in-place writes are the ones that do
 * not change what was checked — archiving, a source approval, a calibration
 * result. A signed Step Qualification is never changed.
 */
export interface EvaluationRepository {
  appendBrief(brief: EvaluationBrief): Promise<EvaluationBrief>;
  /** Newest first. */
  listBriefs(step: EvaluatedStep): Promise<EvaluationBrief[]>;

  createEvaluator(evaluator: Evaluator, firstVersion: EvaluatorVersion): Promise<void>;
  getEvaluator(id: string): Promise<Evaluator | null>;
  listEvaluators(step: EvaluatedStep): Promise<Evaluator[]>;
  setEvaluatorArchived(id: string, archived: boolean): Promise<void>;
  appendEvaluatorVersion(version: EvaluatorVersion): Promise<EvaluatorVersion>;
  /** Oldest first. */
  listEvaluatorVersions(evaluatorId: string): Promise<EvaluatorVersion[]>;
  setSourceApproval(evaluatorId: string, version: number, approval: SourceApproval): Promise<void>;
  setCalibration(evaluatorId: string, version: number, calibration: JudgeCalibration): Promise<void>;

  createCase(evalCase: EvalCase): Promise<EvalCase>;
  getCase(id: string): Promise<EvalCase | null>;
  /** Newest first, archived cases included. */
  listCases(step: EvaluatedStep): Promise<EvalCase[]>;
  setCaseArchived(id: string, archived: boolean): Promise<void>;

  appendDatasetVersion(dataset: EvalDatasetVersion): Promise<EvalDatasetVersion>;
  getDatasetVersion(id: string): Promise<EvalDatasetVersion | null>;
  /** Newest first. */
  listDatasetVersions(step: EvaluatedStep): Promise<EvalDatasetVersion[]>;

  getMcpPolicy(step: EvaluatedStep): Promise<McpEvalPolicy | null>;
  putMcpPolicy(policy: McpEvalPolicy): Promise<McpEvalPolicy>;

  appendAcceptanceCriteria(criteria: AcceptanceCriteriaVersion): Promise<AcceptanceCriteriaVersion>;
  /** Newest first. */
  listAcceptanceCriteria(step: EvaluatedStep): Promise<AcceptanceCriteriaVersion[]>;

  createQualification(qualification: StepQualification): Promise<StepQualification>;
  /** Newest first. */
  listQualifications(step: EvaluatedStep): Promise<StepQualification[]>;

  createEvalRun(run: EvalRun, trials: readonly EvalTrial[]): Promise<void>;
  getEvalRun(id: string): Promise<EvalRun | null>;
  /** Newest first. */
  listEvalRuns(step: EvaluatedStep): Promise<EvalRun[]>;
  /**
   * Every Eval Run the heartbeat must move on, across workspaces: the running
   * ones, and any other — a cancelled one — with a trial still running or scoring.
   */
  listEvalRunIdsToDrive(): Promise<string[]>;
  /** Applies `patch` only while the run is in `from`; true when it did. */
  transitionEvalRun(
    id: string,
    from: EvalRunStatus,
    patch: Partial<Pick<EvalRun, 'status' | 'startedAt' | 'completedAt'>>,
  ): Promise<boolean>;
  /** Atomically adds a trial's cost to the run's spend. */
  addEvalRunSpend(id: string, usd: number): Promise<void>;

  /** By case, then variant, then trial index. */
  listTrials(evalRunId: string): Promise<EvalTrial[]>;
  getTrialByInstanceId(processInstanceId: string): Promise<EvalTrial | null>;
  /** Applies `patch` only while the trial is in `from`; true when it did. */
  transitionTrial(
    id: string,
    from: EvalTrialStatus,
    patch: Partial<Omit<EvalTrial, 'id' | 'evalRunId' | 'caseId' | 'trialIndex'>>,
  ): Promise<boolean>;
  /** Takes over a `scoring` claim made before `staleBefore`, restamping it `now` and counting the attempt; true when it did. */
  renewScoringClaim(id: string, staleBefore: string, now: string): Promise<boolean>;
}
