import type {
  AcceptanceCriteriaVersion,
  AgentDefinitionRepository,
  AgentVersion,
  StepQualification,
  EvalRun,
  EvalRunAcceptance,
  EvalRunStatus,
  EvalTrial,
  EvalTrialStatus,
  EvalCase,
  EvalDatasetVersion,
  EvaluationSubject,
  EvaluationBrief,
  EvaluationRepository,
  Evaluator,
  EvaluatorVersion,
  McpEvalPolicy,
  McpRecordedCase,
  McpRecordedCaseFilter,
  McpRecording,
  McpRecordingFilter,
  SourceApproval,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth';
import { AuthorizedScope } from './authorized-repository';

/** What a subject or row names its owner by: a Step's has no `agentId`, an Agent's does. */
interface EvaluationOwnerRef {
  readonly namespace: string;
  readonly agentId?: string | null;
}

/**
 * The Evaluation domain (ADR-0023), gated on its owner's workspace. A call that
 * names a Step outside the caller's workspaces reads as empty; a row fetched by
 * id from another workspace reads as `null`, which handlers turn into 404. An
 * Agent's Evaluation is read by whoever may see the Agent (ADR-0029), so a
 * public Agent's reads from every workspace. Writes into another workspace are
 * refused. Whether the caller may *change* a Step's evaluation is the
 * workflow's `edit` verb, asked by the handler.
 */
export class AuthorizedEvaluationRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: EvaluationRepository,
    private readonly agentDefinitions: AgentDefinitionRepository,
  ) {
    super(caller);
  }

  appendBrief = async (brief: EvaluationBrief): Promise<EvaluationBrief> => {
    this.assertNamespaceWrite(brief.namespace);
    return this.raw.appendBrief(brief);
  };

  listBriefs = async (subject: EvaluationSubject): Promise<EvaluationBrief[]> =>
    (await this.canRead(subject)) ? this.raw.listBriefs(subject) : [];

  createEvaluator = async (evaluator: Evaluator, firstVersion: EvaluatorVersion): Promise<void> => {
    this.assertNamespaceWrite(evaluator.namespace);
    await this.raw.createEvaluator(evaluator, firstVersion);
  };

  getEvaluator = async (id: string): Promise<Evaluator | null> => await this.visible(await this.raw.getEvaluator(id));

  listEvaluators = async (subject: EvaluationSubject): Promise<Evaluator[]> =>
    (await this.canRead(subject)) ? this.raw.listEvaluators(subject) : [];

  /** The versions of an Evaluator the caller can see, oldest first; `[]` when it is not visible. */
  listEvaluatorVersions = async (evaluatorId: string): Promise<EvaluatorVersion[]> =>
    (await this.getEvaluator(evaluatorId)) === null ? [] : this.raw.listEvaluatorVersions(evaluatorId);

  setEvaluatorArchived = async (evaluator: Evaluator, archived: boolean): Promise<void> => {
    this.assertNamespaceWrite(evaluator.namespace);
    await this.raw.setEvaluatorArchived(evaluator.id, archived);
  };

  setEvaluatorRunInProduction = async (evaluator: Evaluator, runInProduction: boolean): Promise<void> => {
    this.assertNamespaceWrite(evaluator.namespace);
    await this.raw.setEvaluatorRunInProduction(evaluator.id, runInProduction);
  };

  appendEvaluatorVersion = async (evaluator: Evaluator, version: EvaluatorVersion): Promise<EvaluatorVersion> => {
    this.assertNamespaceWrite(evaluator.namespace);
    return this.raw.appendEvaluatorVersion(version);
  };

  setSourceApproval = async (evaluator: Evaluator, version: number, approval: SourceApproval): Promise<void> => {
    this.assertNamespaceWrite(evaluator.namespace);
    await this.raw.setSourceApproval(evaluator.id, version, approval);
  };

  createCase = async (evalCase: EvalCase): Promise<EvalCase> => {
    this.assertNamespaceWrite(evalCase.namespace);
    return this.raw.createCase(evalCase);
  };

  getCase = async (id: string): Promise<EvalCase | null> => await this.visible(await this.raw.getCase(id));

  listCases = async (subject: EvaluationSubject): Promise<EvalCase[]> =>
    (await this.canRead(subject)) ? this.raw.listCases(subject) : [];

  setCaseArchived = async (evalCase: EvalCase, archived: boolean): Promise<void> => {
    this.assertNamespaceWrite(evalCase.namespace);
    await this.raw.setCaseArchived(evalCase.id, archived);
  };

  appendDatasetVersion = async (dataset: EvalDatasetVersion): Promise<EvalDatasetVersion> => {
    this.assertNamespaceWrite(dataset.namespace);
    return this.raw.appendDatasetVersion(dataset);
  };

  getDatasetVersion = async (id: string): Promise<EvalDatasetVersion | null> =>
    await this.visible(await this.raw.getDatasetVersion(id));

  listDatasetVersions = async (subject: EvaluationSubject): Promise<EvalDatasetVersion[]> =>
    (await this.canRead(subject)) ? this.raw.listDatasetVersions(subject) : [];

  getMcpPolicy = async (subject: EvaluationSubject): Promise<McpEvalPolicy | null> =>
    (await this.canRead(subject)) ? this.raw.getMcpPolicy(subject) : null;

  putMcpPolicy = async (policy: McpEvalPolicy): Promise<McpEvalPolicy> => {
    this.assertNamespaceWrite(policy.namespace);
    return this.raw.putMcpPolicy(policy);
  };

  appendMcpRecording = async (recording: McpRecording): Promise<void> => {
    this.assertNamespaceWrite(recording.namespace);
    await this.raw.appendMcpRecording(recording);
  };

  listMcpRecordings = async (subject: EvaluationSubject, filter?: McpRecordingFilter): Promise<McpRecording[]> =>
    (await this.canRead(subject)) ? this.raw.listMcpRecordings(subject, filter) : [];

  listMcpRecordedCases = async (subject: EvaluationSubject, filter?: McpRecordedCaseFilter): Promise<McpRecordedCase[]> =>
    (await this.canRead(subject)) ? this.raw.listMcpRecordedCases(subject, filter) : [];

  appendAcceptanceCriteria = async (criteria: AcceptanceCriteriaVersion): Promise<AcceptanceCriteriaVersion> => {
    this.assertNamespaceWrite(criteria.namespace);
    return this.raw.appendAcceptanceCriteria(criteria);
  };

  listAcceptanceCriteria = async (subject: EvaluationSubject): Promise<AcceptanceCriteriaVersion[]> =>
    (await this.canRead(subject)) ? this.raw.listAcceptanceCriteria(subject) : [];

  createQualification = async (qualification: StepQualification): Promise<StepQualification> => {
    this.assertNamespaceWrite(qualification.namespace);
    return this.raw.createQualification(qualification);
  };

  listQualifications = async (subject: EvaluationSubject): Promise<StepQualification[]> =>
    (await this.canRead(subject)) ? this.raw.listQualifications(subject) : [];

  createEvalRun = async (run: EvalRun, trials: readonly EvalTrial[]): Promise<void> => {
    this.assertNamespaceWrite(run.namespace);
    await this.raw.createEvalRun(run, trials);
  };

  getEvalRun = async (id: string): Promise<EvalRun | null> => await this.visible(await this.raw.getEvalRun(id));

  /**
   * The Agent version an Agent's Eval Run assessed (ADR-0029), for whoever may
   * read the run — even once the Agent is deleted or out of the caller's
   * sight, since the run shows the configuration it assessed.
   */
  getAssessedAgentVersion = async (evalRunId: string): Promise<AgentVersion | null> => {
    const run = await this.getEvalRun(evalRunId);
    if (run === null || run.agentId === null || run.agentVersion === null) return null;
    return this.agentDefinitions.getVersion(run.agentId, run.agentVersion);
  };

  listEvalRuns = async (subject: EvaluationSubject): Promise<EvalRun[]> =>
    (await this.canRead(subject)) ? this.raw.listEvalRuns(subject) : [];

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

  setEvalRunAcceptance = async (id: string, acceptance: EvalRunAcceptance): Promise<void> => {
    await this.writableRun(id);
    await this.raw.setEvalRunAcceptance(id, acceptance);
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

  private async visible<T extends EvaluationOwnerRef>(row: T | null): Promise<T | null> {
    return row !== null && (await this.canRead(row)) ? row : null;
  }

  private async canRead(owner: EvaluationOwnerRef): Promise<boolean> {
    if (this.caller.isSystemActor || this.canSeeNamespace(owner.namespace)) return true;
    if (typeof owner.agentId !== 'string') return false;
    const agent = await this.agentDefinitions.getByIdVisibleTo(owner.agentId, [...this.caller.namespaces]);
    return agent !== null && agent.namespace === owner.namespace;
  }
}
