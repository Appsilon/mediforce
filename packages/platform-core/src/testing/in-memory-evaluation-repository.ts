import type { EvaluationRepository } from '../interfaces/evaluation-repository';
import {
  EvalRunSchema,
  EvalTrialSchema,
  type EvalRun,
  type EvalRunStatus,
  type EvalTrial,
  type EvalTrialStatus,
} from '../schemas/eval-run';
import {
  EvalCaseSchema,
  EvalDatasetVersionSchema,
  EvaluationBriefSchema,
  EvaluatorSchema,
  EvaluatorVersionSchema,
  McpEvalPolicySchema,
  type EvalCase,
  type EvalDatasetVersion,
  type EvaluatedStep,
  type EvaluationBrief,
  type Evaluator,
  type EvaluatorVersion,
  type JudgeCalibration,
  type McpEvalPolicy,
  type SourceApproval,
} from '../schemas/evaluation';

function sameStep(left: EvaluatedStep, right: EvaluatedStep): boolean {
  return left.namespace === right.namespace
    && left.workflowName === right.workflowName
    && left.stepId === right.stepId;
}

function newestFirst<T extends { createdAt: string }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export class InMemoryEvaluationRepository implements EvaluationRepository {
  private readonly briefs: EvaluationBrief[] = [];
  private readonly evaluators = new Map<string, Evaluator>();
  private readonly versions: EvaluatorVersion[] = [];
  private readonly cases = new Map<string, EvalCase>();
  private readonly datasets: EvalDatasetVersion[] = [];
  private readonly policies: McpEvalPolicy[] = [];
  private readonly runs = new Map<string, EvalRun>();
  private readonly trials = new Map<string, EvalTrial>();

  async appendBrief(brief: EvaluationBrief): Promise<EvaluationBrief> {
    const parsed = EvaluationBriefSchema.parse(brief);
    if (this.briefs.some((row) => sameStep(row, parsed) && row.version === parsed.version)) {
      throw new Error(`Evaluation Brief version ${parsed.version} already exists`);
    }
    this.briefs.push(parsed);
    return parsed;
  }

  async listBriefs(step: EvaluatedStep): Promise<EvaluationBrief[]> {
    return this.briefs.filter((row) => sameStep(row, step)).sort((left, right) => right.version - left.version);
  }

  async createEvaluator(evaluator: Evaluator, firstVersion: EvaluatorVersion): Promise<void> {
    const parsed = EvaluatorSchema.parse(evaluator);
    const clash = [...this.evaluators.values()].some((row) => sameStep(row, parsed) && row.name === parsed.name);
    if (clash) throw new Error(`Evaluator '${parsed.name}' already exists on this step`);
    this.evaluators.set(parsed.id, parsed);
    this.versions.push(EvaluatorVersionSchema.parse(firstVersion));
  }

  async getEvaluator(id: string): Promise<Evaluator | null> {
    return this.evaluators.get(id) ?? null;
  }

  async listEvaluators(step: EvaluatedStep): Promise<Evaluator[]> {
    return [...this.evaluators.values()]
      .filter((row) => sameStep(row, step))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async setEvaluatorArchived(id: string, archived: boolean): Promise<void> {
    const row = this.evaluators.get(id);
    if (row !== undefined) this.evaluators.set(id, { ...row, archived });
  }

  async appendEvaluatorVersion(version: EvaluatorVersion): Promise<EvaluatorVersion> {
    const parsed = EvaluatorVersionSchema.parse(version);
    if (this.versions.some((row) => row.evaluatorId === parsed.evaluatorId && row.version === parsed.version)) {
      throw new Error(`Evaluator version ${parsed.version} already exists`);
    }
    this.versions.push(parsed);
    return parsed;
  }

  async listEvaluatorVersions(evaluatorId: string): Promise<EvaluatorVersion[]> {
    return this.versions
      .filter((row) => row.evaluatorId === evaluatorId)
      .sort((left, right) => left.version - right.version);
  }

  async setSourceApproval(evaluatorId: string, version: number, approval: SourceApproval): Promise<void> {
    this.patchVersion(evaluatorId, version, { sourceApproval: approval });
  }

  async setCalibration(evaluatorId: string, version: number, calibration: JudgeCalibration): Promise<void> {
    this.patchVersion(evaluatorId, version, { calibration });
  }

  async createCase(evalCase: EvalCase): Promise<EvalCase> {
    const parsed = EvalCaseSchema.parse(evalCase);
    this.cases.set(parsed.id, parsed);
    return parsed;
  }

  async getCase(id: string): Promise<EvalCase | null> {
    return this.cases.get(id) ?? null;
  }

  async listCases(step: EvaluatedStep): Promise<EvalCase[]> {
    return newestFirst([...this.cases.values()].filter((row) => sameStep(row, step)));
  }

  async setCaseArchived(id: string, archived: boolean): Promise<void> {
    const row = this.cases.get(id);
    if (row !== undefined) this.cases.set(id, { ...row, archived });
  }

  async appendDatasetVersion(dataset: EvalDatasetVersion): Promise<EvalDatasetVersion> {
    const parsed = EvalDatasetVersionSchema.parse(dataset);
    if (this.datasets.some((row) => sameStep(row, parsed) && row.version === parsed.version)) {
      throw new Error(`Eval Dataset version ${parsed.version} already exists`);
    }
    this.datasets.push(parsed);
    return parsed;
  }

  async getDatasetVersion(id: string): Promise<EvalDatasetVersion | null> {
    return this.datasets.find((row) => row.id === id) ?? null;
  }

  async listDatasetVersions(step: EvaluatedStep): Promise<EvalDatasetVersion[]> {
    return this.datasets.filter((row) => sameStep(row, step)).sort((left, right) => right.version - left.version);
  }

  async getMcpPolicy(step: EvaluatedStep): Promise<McpEvalPolicy | null> {
    return this.policies.find((row) => sameStep(row, step)) ?? null;
  }

  async putMcpPolicy(policy: McpEvalPolicy): Promise<McpEvalPolicy> {
    const parsed = McpEvalPolicySchema.parse(policy);
    const index = this.policies.findIndex((row) => sameStep(row, parsed));
    if (index === -1) this.policies.push(parsed);
    else this.policies[index] = parsed;
    return parsed;
  }

  async createEvalRun(run: EvalRun, trials: readonly EvalTrial[]): Promise<void> {
    this.runs.set(run.id, EvalRunSchema.parse(run));
    for (const trial of trials) this.trials.set(trial.id, EvalTrialSchema.parse(trial));
  }

  async getEvalRun(id: string): Promise<EvalRun | null> {
    return this.runs.get(id) ?? null;
  }

  async listEvalRuns(step: EvaluatedStep): Promise<EvalRun[]> {
    return newestFirst([...this.runs.values()].filter((run) => sameStep(run, step)));
  }

  async listEvalRunIdsByStatus(status: EvalRunStatus): Promise<string[]> {
    return [...this.runs.values()].filter((run) => run.status === status).map((run) => run.id);
  }

  async transitionEvalRun(
    id: string,
    from: EvalRunStatus,
    patch: Partial<Pick<EvalRun, 'status' | 'startedAt' | 'completedAt'>>,
  ): Promise<boolean> {
    const run = this.runs.get(id);
    if (run === undefined || run.status !== from) return false;
    this.runs.set(id, { ...run, ...patch });
    return true;
  }

  async addEvalRunSpend(id: string, usd: number): Promise<void> {
    const run = this.runs.get(id);
    if (run !== undefined) this.runs.set(id, { ...run, spentUsd: run.spentUsd + usd });
  }

  async listTrials(evalRunId: string): Promise<EvalTrial[]> {
    return [...this.trials.values()]
      .filter((trial) => trial.evalRunId === evalRunId)
      .sort((left, right) => left.caseId.localeCompare(right.caseId) || left.trialIndex - right.trialIndex);
  }

  async getTrialByInstanceId(processInstanceId: string): Promise<EvalTrial | null> {
    return [...this.trials.values()].find((trial) => trial.processInstanceId === processInstanceId) ?? null;
  }

  async transitionTrial(
    id: string,
    from: EvalTrialStatus,
    patch: Partial<Omit<EvalTrial, 'id' | 'evalRunId' | 'caseId' | 'trialIndex'>>,
  ): Promise<boolean> {
    const trial = this.trials.get(id);
    if (trial === undefined || trial.status !== from) return false;
    this.trials.set(id, EvalTrialSchema.parse({ ...trial, ...patch }));
    return true;
  }

  private patchVersion(evaluatorId: string, version: number, patch: Partial<EvaluatorVersion>): void {
    const index = this.versions.findIndex((row) => row.evaluatorId === evaluatorId && row.version === version);
    if (index !== -1) this.versions[index] = { ...this.versions[index]!, ...patch };
  }
}
