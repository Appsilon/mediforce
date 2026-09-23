import type {
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
 * versions, Eval Cases, frozen Eval Dataset versions and MCP eval policies.
 * Every row carries its Step's namespace, so the authorized wrapper gates each
 * call on the namespace it names or the row it returns.
 *
 * Versioned rows are append-only: a Brief or Evaluator change is a new version,
 * and the only in-place writes are the ones that do not change what was
 * checked — archiving, a source approval, a calibration result.
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
}
