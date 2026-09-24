import type {
  EvalRun,
  EvalRunStatus,
  EvalTrial,
  EvalTrialStatus,
  EvalCase,
  EvalDatasetVersion,
  EvaluatedStep,
  EvaluationBrief,
  EvaluationRepository,
  Evaluator,
  EvaluatorVersion,
  JudgeCalibration,
  McpEvalPolicy,
  SourceApproval,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth';
import { AuthorizedScope } from './authorized-repository';

/**
 * The Evaluation domain (ADR-0023), gated on the Step's workspace. A call that
 * names a Step outside the caller's workspaces reads as empty; a row fetched by
 * id from another workspace reads as `null`, which handlers turn into 404.
 * Writes into another workspace are refused. Whether the caller may *change* a
 * Step's evaluation is the workflow's `edit` verb, asked by the handler.
 */
export class AuthorizedEvaluationRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: EvaluationRepository,
  ) {
    super(caller);
  }

  appendBrief = async (brief: EvaluationBrief): Promise<EvaluationBrief> => {
    this.assertNamespaceWrite(brief.namespace);
    return this.raw.appendBrief(brief);
  };

  listBriefs = async (step: EvaluatedStep): Promise<EvaluationBrief[]> =>
    this.canSeeNamespace(step.namespace) ? this.raw.listBriefs(step) : [];

  createEvaluator = async (evaluator: Evaluator, firstVersion: EvaluatorVersion): Promise<void> => {
    this.assertNamespaceWrite(evaluator.namespace);
    await this.raw.createEvaluator(evaluator, firstVersion);
  };

  getEvaluator = async (id: string): Promise<Evaluator | null> => this.visible(await this.raw.getEvaluator(id));

  listEvaluators = async (step: EvaluatedStep): Promise<Evaluator[]> =>
    this.canSeeNamespace(step.namespace) ? this.raw.listEvaluators(step) : [];

  /** The versions of an Evaluator the caller can see, oldest first; `[]` when it is not visible. */
  listEvaluatorVersions = async (evaluatorId: string): Promise<EvaluatorVersion[]> =>
    (await this.getEvaluator(evaluatorId)) === null ? [] : this.raw.listEvaluatorVersions(evaluatorId);

  setEvaluatorArchived = async (evaluator: Evaluator, archived: boolean): Promise<void> => {
    this.assertNamespaceWrite(evaluator.namespace);
    await this.raw.setEvaluatorArchived(evaluator.id, archived);
  };

  appendEvaluatorVersion = async (evaluator: Evaluator, version: EvaluatorVersion): Promise<EvaluatorVersion> => {
    this.assertNamespaceWrite(evaluator.namespace);
    return this.raw.appendEvaluatorVersion(version);
  };

  setSourceApproval = async (evaluator: Evaluator, version: number, approval: SourceApproval): Promise<void> => {
    this.assertNamespaceWrite(evaluator.namespace);
    await this.raw.setSourceApproval(evaluator.id, version, approval);
  };

  setCalibration = async (evaluator: Evaluator, version: number, calibration: JudgeCalibration): Promise<void> => {
    this.assertNamespaceWrite(evaluator.namespace);
    await this.raw.setCalibration(evaluator.id, version, calibration);
  };

  createCase = async (evalCase: EvalCase): Promise<EvalCase> => {
    this.assertNamespaceWrite(evalCase.namespace);
    return this.raw.createCase(evalCase);
  };

  getCase = async (id: string): Promise<EvalCase | null> => this.visible(await this.raw.getCase(id));

  listCases = async (step: EvaluatedStep): Promise<EvalCase[]> =>
    this.canSeeNamespace(step.namespace) ? this.raw.listCases(step) : [];

  setCaseArchived = async (evalCase: EvalCase, archived: boolean): Promise<void> => {
    this.assertNamespaceWrite(evalCase.namespace);
    await this.raw.setCaseArchived(evalCase.id, archived);
  };

  appendDatasetVersion = async (dataset: EvalDatasetVersion): Promise<EvalDatasetVersion> => {
    this.assertNamespaceWrite(dataset.namespace);
    return this.raw.appendDatasetVersion(dataset);
  };

  getDatasetVersion = async (id: string): Promise<EvalDatasetVersion | null> =>
    this.visible(await this.raw.getDatasetVersion(id));

  listDatasetVersions = async (step: EvaluatedStep): Promise<EvalDatasetVersion[]> =>
    this.canSeeNamespace(step.namespace) ? this.raw.listDatasetVersions(step) : [];

  getMcpPolicy = async (step: EvaluatedStep): Promise<McpEvalPolicy | null> =>
    this.canSeeNamespace(step.namespace) ? this.raw.getMcpPolicy(step) : null;

  putMcpPolicy = async (policy: McpEvalPolicy): Promise<McpEvalPolicy> => {
    this.assertNamespaceWrite(policy.namespace);
    return this.raw.putMcpPolicy(policy);
  };

  createEvalRun = async (run: EvalRun, trials: readonly EvalTrial[]): Promise<void> => {
    this.assertNamespaceWrite(run.namespace);
    await this.raw.createEvalRun(run, trials);
  };

  getEvalRun = async (id: string): Promise<EvalRun | null> => this.visible(await this.raw.getEvalRun(id));

  listEvalRuns = async (step: EvaluatedStep): Promise<EvalRun[]> =>
    this.canSeeNamespace(step.namespace) ? this.raw.listEvalRuns(step) : [];

  /** The Eval Runs the heartbeat moves on, across workspaces — system actors only. */
  listEvalRunIdsToDrive = async (): Promise<string[]> =>
    this.caller.isSystemActor ? this.raw.listEvalRunIdsToDrive() : [];

  transitionEvalRun = async (
    id: string,
    from: EvalRunStatus,
    patch: Partial<Pick<EvalRun, 'status' | 'startedAt' | 'completedAt'>>,
  ): Promise<boolean> => {
    await this.writableRun(id);
    return this.raw.transitionEvalRun(id, from, patch);
  };

  addEvalRunSpend = async (id: string, usd: number): Promise<void> => {
    await this.writableRun(id);
    await this.raw.addEvalRunSpend(id, usd);
  };

  /** A run's trials; `[]` when the run is not visible. */
  listTrials = async (evalRunId: string): Promise<EvalTrial[]> =>
    (await this.getEvalRun(evalRunId)) === null ? [] : this.raw.listTrials(evalRunId);

  getTrialByInstanceId = async (processInstanceId: string): Promise<EvalTrial | null> => {
    const trial = await this.raw.getTrialByInstanceId(processInstanceId);
    return trial !== null && (await this.getEvalRun(trial.evalRunId)) !== null ? trial : null;
  };

  transitionTrial = async (
    trial: Pick<EvalTrial, 'id' | 'evalRunId'>,
    from: EvalTrialStatus,
    patch: Partial<Omit<EvalTrial, 'id' | 'evalRunId' | 'caseId' | 'trialIndex'>>,
  ): Promise<boolean> => {
    await this.writableRun(trial.evalRunId);
    return this.raw.transitionTrial(trial.id, from, patch);
  };

  renewScoringClaim = async (trial: Pick<EvalTrial, 'id' | 'evalRunId'>, staleBefore: string, now: string): Promise<boolean> => {
    await this.writableRun(trial.evalRunId);
    return this.raw.renewScoringClaim(trial.id, staleBefore, now);
  };

  private async writableRun(id: string): Promise<void> {
    const run = await this.raw.getEvalRun(id);
    this.assertNamespaceWrite(run?.namespace);
  }

  private visible<T extends { namespace: string }>(row: T | null): T | null {
    return row !== null && this.canSeeNamespace(row.namespace) ? row : null;
  }
}
