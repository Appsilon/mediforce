import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import {
  AcceptanceCriteriaVersionSchema,
  StepQualificationSchema,
  type AcceptanceCriteriaVersion,
  type StepQualification,
  EvalRunSchema,
  EvalTrialSchema,
  type EvalRun,
  type EvalRunStatus,
  type EvalTrial,
  type EvalTrialStatus,
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
  type EvaluationRepository,
  type Evaluator,
  type EvaluatorVersion,
  type JudgeCalibration,
  type McpEvalPolicy,
  type SourceApproval,
} from '@mediforce/platform-core';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Database } from '../client';
import {
  evalAcceptanceCriteria,
  evalCases,
  evalDatasetVersions,
  evalRuns,
  evalTrials,
  evaluationBriefs,
  evaluatorVersions,
  evaluators,
  mcpEvalPolicies,
  stepQualifications,
} from '../schema/evaluation';

type StepColumns = {
  workspace: PgColumn;
  workflowName: PgColumn;
  stepId: PgColumn;
};

function onStep(table: StepColumns, step: EvaluatedStep) {
  return and(
    eq(table.workspace, step.namespace),
    eq(table.workflowName, step.workflowName),
    eq(table.stepId, step.stepId),
  );
}

function stepFields(row: { workspace: string; workflowName: string; stepId: string }): EvaluatedStep {
  return { namespace: row.workspace, workflowName: row.workflowName, stepId: row.stepId };
}

function toBrief(row: typeof evaluationBriefs.$inferSelect): EvaluationBrief {
  return EvaluationBriefSchema.parse({
    ...stepFields(row),
    version: row.version,
    text: row.text,
    origin: row.origin,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  });
}

function toEvaluator(row: typeof evaluators.$inferSelect): Evaluator {
  return EvaluatorSchema.parse({
    ...stepFields(row),
    id: row.id,
    name: row.name,
    archived: row.archived,
    runInProduction: row.runInProduction,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  });
}

function toVersion(row: typeof evaluatorVersions.$inferSelect): EvaluatorVersion {
  return EvaluatorVersionSchema.parse({
    evaluatorId: row.evaluatorId,
    version: row.version,
    rule: row.rule,
    severity: row.severity,
    check: row.check,
    origin: row.origin,
    sourceApproval: row.sourceApproval,
    calibration: row.calibration,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  });
}

function toCase(row: typeof evalCases.$inferSelect): EvalCase {
  return EvalCaseSchema.parse({
    ...stepFields(row),
    id: row.id,
    name: row.name,
    input: row.input,
    workspaceSeedCommit: row.workspaceSeedCommit,
    expectation: row.expectation,
    notes: row.notes,
    source: row.source,
    sourceAgentRunId: row.sourceAgentRunId,
    perturbation: row.perturbation,
    origin: row.origin,
    split: row.split,
    containsProductionData: row.containsProductionData,
    archived: row.archived,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  });
}

function toDataset(row: typeof evalDatasetVersions.$inferSelect): EvalDatasetVersion {
  return EvalDatasetVersionSchema.parse({
    ...stepFields(row),
    id: row.id,
    version: row.version,
    caseIds: row.caseIds,
    containsProductionData: row.containsProductionData,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  });
}

function toPolicy(row: typeof mcpEvalPolicies.$inferSelect): McpEvalPolicy {
  return McpEvalPolicySchema.parse({
    ...stepFields(row),
    servers: row.servers,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt.toISOString(),
  });
}

function toEvalRun(row: typeof evalRuns.$inferSelect): EvalRun {
  return EvalRunSchema.parse({
    ...stepFields(row),
    id: row.id,
    definitionVersion: row.definitionVersion,
    datasetVersionId: row.datasetVersionId,
    caseIds: row.caseIds,
    exampleCaseIds: row.exampleCaseIds,
    trialsPerCase: row.trialsPerCase,
    concurrency: row.concurrency,
    evaluators: row.evaluators,
    variants: row.variants,
    acceptanceCriteria: row.acceptanceCriteria,
    briefVersion: row.briefVersion,
    mcpPolicy: row.mcpPolicy,
    estimate: row.estimate,
    budgetUsd: row.budgetUsd,
    spentUsd: row.spentUsd,
    status: row.status,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  });
}

function toCriteria(row: typeof evalAcceptanceCriteria.$inferSelect): AcceptanceCriteriaVersion {
  return AcceptanceCriteriaVersionSchema.parse({
    ...stepFields(row),
    version: row.version,
    criteria: row.criteria,
    origin: row.origin,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  });
}

function toTrial(row: typeof evalTrials.$inferSelect): EvalTrial {
  return EvalTrialSchema.parse({
    ...row,
    startedAt: row.startedAt?.toISOString() ?? null,
    scoringStartedAt: row.scoringStartedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  });
}

function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function trialValues(trial: Partial<EvalTrial>): Partial<typeof evalTrials.$inferInsert> {
  const { startedAt, scoringStartedAt, completedAt, ...rest } = trial;
  return {
    ...rest,
    ...(startedAt === undefined ? {} : { startedAt: toDate(startedAt) }),
    ...(scoringStartedAt === undefined ? {} : { scoringStartedAt: toDate(scoringStartedAt) }),
    ...(completedAt === undefined ? {} : { completedAt: toDate(completedAt) }),
  };
}

/** Postgres-backed Evaluation domain storage (ADR-0023). */
export class PostgresEvaluationRepository implements EvaluationRepository {
  constructor(private readonly db: Database) {}

  async appendBrief(brief: EvaluationBrief): Promise<EvaluationBrief> {
    const parsed = EvaluationBriefSchema.parse(brief);
    const [row] = await this.db.insert(evaluationBriefs).values({
      workspace: parsed.namespace,
      workflowName: parsed.workflowName,
      stepId: parsed.stepId,
      version: parsed.version,
      text: parsed.text,
      origin: parsed.origin,
      createdBy: parsed.createdBy,
      createdAt: new Date(parsed.createdAt),
    }).returning();
    return toBrief(row!);
  }

  async listBriefs(step: EvaluatedStep): Promise<EvaluationBrief[]> {
    const rows = await this.db.select().from(evaluationBriefs)
      .where(onStep(evaluationBriefs, step))
      .orderBy(desc(evaluationBriefs.version));
    return rows.map(toBrief);
  }

  async createEvaluator(evaluator: Evaluator, firstVersion: EvaluatorVersion): Promise<void> {
    const parsed = EvaluatorSchema.parse(evaluator);
    const version = EvaluatorVersionSchema.parse(firstVersion);
    await this.db.transaction(async (tx) => {
      await tx.insert(evaluators).values({
        id: parsed.id,
        workspace: parsed.namespace,
        workflowName: parsed.workflowName,
        stepId: parsed.stepId,
        name: parsed.name,
        archived: parsed.archived,
        runInProduction: parsed.runInProduction,
        createdBy: parsed.createdBy,
        createdAt: new Date(parsed.createdAt),
      });
      await tx.insert(evaluatorVersions).values(versionValues(version));
    });
  }

  async getEvaluator(id: string): Promise<Evaluator | null> {
    const [row] = await this.db.select().from(evaluators).where(eq(evaluators.id, id)).limit(1);
    return row === undefined ? null : toEvaluator(row);
  }

  async listEvaluators(step: EvaluatedStep): Promise<Evaluator[]> {
    const rows = await this.db.select().from(evaluators)
      .where(onStep(evaluators, step))
      .orderBy(asc(evaluators.name));
    return rows.map(toEvaluator);
  }

  async setEvaluatorArchived(id: string, archived: boolean): Promise<void> {
    await this.db.update(evaluators).set({ archived }).where(eq(evaluators.id, id));
  }

  async setEvaluatorRunInProduction(id: string, runInProduction: boolean): Promise<void> {
    await this.db.update(evaluators).set({ runInProduction }).where(eq(evaluators.id, id));
  }

  async appendEvaluatorVersion(version: EvaluatorVersion): Promise<EvaluatorVersion> {
    const parsed = EvaluatorVersionSchema.parse(version);
    const [row] = await this.db.insert(evaluatorVersions).values(versionValues(parsed)).returning();
    return toVersion(row!);
  }

  async listEvaluatorVersions(evaluatorId: string): Promise<EvaluatorVersion[]> {
    const rows = await this.db.select().from(evaluatorVersions)
      .where(eq(evaluatorVersions.evaluatorId, evaluatorId))
      .orderBy(asc(evaluatorVersions.version));
    return rows.map(toVersion);
  }

  async setSourceApproval(evaluatorId: string, version: number, approval: SourceApproval): Promise<void> {
    await this.db.update(evaluatorVersions)
      .set({ sourceApproval: approval })
      .where(and(eq(evaluatorVersions.evaluatorId, evaluatorId), eq(evaluatorVersions.version, version)));
  }

  async setCalibration(evaluatorId: string, version: number, calibration: JudgeCalibration): Promise<void> {
    await this.db.update(evaluatorVersions)
      .set({ calibration })
      .where(and(eq(evaluatorVersions.evaluatorId, evaluatorId), eq(evaluatorVersions.version, version)));
  }

  async createCase(evalCase: EvalCase): Promise<EvalCase> {
    const parsed = EvalCaseSchema.parse(evalCase);
    const [row] = await this.db.insert(evalCases).values({
      id: parsed.id,
      workspace: parsed.namespace,
      workflowName: parsed.workflowName,
      stepId: parsed.stepId,
      name: parsed.name,
      input: parsed.input,
      workspaceSeedCommit: parsed.workspaceSeedCommit,
      expectation: parsed.expectation,
      notes: parsed.notes,
      source: parsed.source,
      sourceAgentRunId: parsed.sourceAgentRunId,
      perturbation: parsed.perturbation,
      origin: parsed.origin,
      split: parsed.split,
      containsProductionData: parsed.containsProductionData,
      archived: parsed.archived,
      createdBy: parsed.createdBy,
      createdAt: new Date(parsed.createdAt),
    }).returning();
    return toCase(row!);
  }

  async getCase(id: string): Promise<EvalCase | null> {
    const [row] = await this.db.select().from(evalCases).where(eq(evalCases.id, id)).limit(1);
    return row === undefined ? null : toCase(row);
  }

  async listCases(step: EvaluatedStep): Promise<EvalCase[]> {
    const rows = await this.db.select().from(evalCases)
      .where(onStep(evalCases, step))
      .orderBy(desc(evalCases.createdAt), desc(evalCases.id));
    return rows.map(toCase);
  }

  async setCaseArchived(id: string, archived: boolean): Promise<void> {
    await this.db.update(evalCases).set({ archived }).where(eq(evalCases.id, id));
  }

  async appendDatasetVersion(dataset: EvalDatasetVersion): Promise<EvalDatasetVersion> {
    const parsed = EvalDatasetVersionSchema.parse(dataset);
    const [row] = await this.db.insert(evalDatasetVersions).values({
      id: parsed.id,
      workspace: parsed.namespace,
      workflowName: parsed.workflowName,
      stepId: parsed.stepId,
      version: parsed.version,
      caseIds: parsed.caseIds,
      containsProductionData: parsed.containsProductionData,
      createdBy: parsed.createdBy,
      createdAt: new Date(parsed.createdAt),
    }).returning();
    return toDataset(row!);
  }

  async getDatasetVersion(id: string): Promise<EvalDatasetVersion | null> {
    const [row] = await this.db.select().from(evalDatasetVersions).where(eq(evalDatasetVersions.id, id)).limit(1);
    return row === undefined ? null : toDataset(row);
  }

  async listDatasetVersions(step: EvaluatedStep): Promise<EvalDatasetVersion[]> {
    const rows = await this.db.select().from(evalDatasetVersions)
      .where(onStep(evalDatasetVersions, step))
      .orderBy(desc(evalDatasetVersions.version));
    return rows.map(toDataset);
  }

  async getMcpPolicy(step: EvaluatedStep): Promise<McpEvalPolicy | null> {
    const [row] = await this.db.select().from(mcpEvalPolicies).where(onStep(mcpEvalPolicies, step)).limit(1);
    return row === undefined ? null : toPolicy(row);
  }

  async putMcpPolicy(policy: McpEvalPolicy): Promise<McpEvalPolicy> {
    const parsed = McpEvalPolicySchema.parse(policy);
    const values = {
      workspace: parsed.namespace,
      workflowName: parsed.workflowName,
      stepId: parsed.stepId,
      servers: parsed.servers,
      updatedBy: parsed.updatedBy,
      updatedAt: new Date(parsed.updatedAt),
    };
    const [row] = await this.db.insert(mcpEvalPolicies).values(values)
      .onConflictDoUpdate({
        target: [mcpEvalPolicies.workspace, mcpEvalPolicies.workflowName, mcpEvalPolicies.stepId],
        set: { servers: values.servers, updatedBy: values.updatedBy, updatedAt: values.updatedAt },
      })
      .returning();
    return toPolicy(row!);
  }
  async appendAcceptanceCriteria(criteria: AcceptanceCriteriaVersion): Promise<AcceptanceCriteriaVersion> {
    const parsed = AcceptanceCriteriaVersionSchema.parse(criteria);
    const [row] = await this.db.insert(evalAcceptanceCriteria).values({
      workspace: parsed.namespace,
      workflowName: parsed.workflowName,
      stepId: parsed.stepId,
      version: parsed.version,
      criteria: parsed.criteria,
      origin: parsed.origin,
      createdBy: parsed.createdBy,
      createdAt: new Date(parsed.createdAt),
    }).returning();
    return toCriteria(row!);
  }

  async listAcceptanceCriteria(step: EvaluatedStep): Promise<AcceptanceCriteriaVersion[]> {
    const rows = await this.db.select().from(evalAcceptanceCriteria)
      .where(onStep(evalAcceptanceCriteria, step))
      .orderBy(desc(evalAcceptanceCriteria.version));
    return rows.map(toCriteria);
  }

  async createQualification(qualification: StepQualification): Promise<StepQualification> {
    const parsed = StepQualificationSchema.parse(qualification);
    await this.db.insert(stepQualifications).values({
      id: parsed.id,
      workspace: parsed.namespace,
      workflowName: parsed.workflowName,
      stepId: parsed.stepId,
      evalRunId: parsed.evalRunId,
      variantId: parsed.variantId,
      fingerprint: parsed.fingerprint.hash,
      record: parsed,
      signedBy: parsed.signature.signerId,
      signedAt: new Date(parsed.signature.signedAt),
    });
    return parsed;
  }

  async listQualifications(step: EvaluatedStep): Promise<StepQualification[]> {
    const rows = await this.db.select().from(stepQualifications)
      .where(onStep(stepQualifications, step))
      .orderBy(desc(stepQualifications.signedAt), desc(stepQualifications.id));
    return rows.map((row) => StepQualificationSchema.parse(row.record));
  }

  async createEvalRun(run: EvalRun, trials: readonly EvalTrial[]): Promise<void> {
    const parsed = EvalRunSchema.parse(run);
    await this.db.transaction(async (tx) => {
      await tx.insert(evalRuns).values({
        id: parsed.id,
        workspace: parsed.namespace,
        workflowName: parsed.workflowName,
        stepId: parsed.stepId,
        definitionVersion: parsed.definitionVersion,
        datasetVersionId: parsed.datasetVersionId,
        caseIds: parsed.caseIds,
        exampleCaseIds: parsed.exampleCaseIds,
        trialsPerCase: parsed.trialsPerCase,
        concurrency: parsed.concurrency,
        evaluators: parsed.evaluators,
        variants: parsed.variants,
        acceptanceCriteria: parsed.acceptanceCriteria,
        briefVersion: parsed.briefVersion,
        mcpPolicy: parsed.mcpPolicy,
        estimate: parsed.estimate,
        budgetUsd: parsed.budgetUsd,
        spentUsd: parsed.spentUsd,
        status: parsed.status,
        createdBy: parsed.createdBy,
        createdAt: new Date(parsed.createdAt),
        startedAt: parsed.startedAt === null ? null : new Date(parsed.startedAt),
        completedAt: parsed.completedAt === null ? null : new Date(parsed.completedAt),
      });
      if (trials.length > 0) {
        await tx.insert(evalTrials).values(trials.map((trial) => {
          const parsedTrial = EvalTrialSchema.parse(trial);
          return trialValues(parsedTrial) as typeof evalTrials.$inferInsert;
        }));
      }
    });
  }

  async getEvalRun(id: string): Promise<EvalRun | null> {
    const [row] = await this.db.select().from(evalRuns).where(eq(evalRuns.id, id)).limit(1);
    return row === undefined ? null : toEvalRun(row);
  }

  async listEvalRuns(step: EvaluatedStep): Promise<EvalRun[]> {
    const rows = await this.db.select().from(evalRuns)
      .where(onStep(evalRuns, step))
      .orderBy(desc(evalRuns.createdAt), desc(evalRuns.id));
    return rows.map(toEvalRun);
  }

  async listEvalRunIdsToDrive(): Promise<string[]> {
    const running = await this.db.select({ id: evalRuns.id }).from(evalRuns).where(eq(evalRuns.status, 'running'));
    const inFlight = await this.db.selectDistinct({ id: evalTrials.evalRunId }).from(evalTrials)
      .where(inArray(evalTrials.status, ['running', 'scoring']));
    return [...new Set([...running, ...inFlight].map((row) => row.id))];
  }

  async transitionEvalRun(
    id: string,
    from: EvalRunStatus,
    patch: Partial<Pick<EvalRun, 'status' | 'startedAt' | 'completedAt'>>,
  ): Promise<boolean> {
    const rows = await this.db.update(evalRuns)
      .set({
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.startedAt === undefined ? {} : { startedAt: patch.startedAt === null ? null : new Date(patch.startedAt) }),
        ...(patch.completedAt === undefined ? {} : { completedAt: patch.completedAt === null ? null : new Date(patch.completedAt) }),
      })
      .where(and(eq(evalRuns.id, id), eq(evalRuns.status, from)))
      .returning({ id: evalRuns.id });
    return rows.length === 1;
  }

  async addEvalRunSpend(id: string, usd: number): Promise<void> {
    await this.db.update(evalRuns)
      .set({ spentUsd: sql`${evalRuns.spentUsd} + ${usd}` })
      .where(eq(evalRuns.id, id));
  }

  async listTrials(evalRunId: string): Promise<EvalTrial[]> {
    const rows = await this.db.select().from(evalTrials)
      .where(eq(evalTrials.evalRunId, evalRunId))
      .orderBy(asc(evalTrials.caseId), asc(evalTrials.variantId), asc(evalTrials.trialIndex));
    return rows.map(toTrial);
  }

  async getTrialByInstanceId(processInstanceId: string): Promise<EvalTrial | null> {
    const [row] = await this.db.select().from(evalTrials)
      .where(eq(evalTrials.processInstanceId, processInstanceId)).limit(1);
    return row === undefined ? null : toTrial(row);
  }

  async transitionTrial(
    id: string,
    from: EvalTrialStatus,
    patch: Partial<Omit<EvalTrial, 'id' | 'evalRunId' | 'caseId' | 'trialIndex'>>,
  ): Promise<boolean> {
    const rows = await this.db.update(evalTrials)
      .set(trialValues(patch))
      .where(and(eq(evalTrials.id, id), eq(evalTrials.status, from)))
      .returning({ id: evalTrials.id });
    return rows.length === 1;
  }

  async renewScoringClaim(id: string, staleBefore: string, now: string): Promise<boolean> {
    const rows = await this.db.update(evalTrials)
      .set({ scoringStartedAt: new Date(now), scoringAttempts: sql`${evalTrials.scoringAttempts} + 1` })
      .where(and(eq(evalTrials.id, id), eq(evalTrials.status, 'scoring'), lt(evalTrials.scoringStartedAt, new Date(staleBefore))))
      .returning({ id: evalTrials.id });
    return rows.length === 1;
  }
}

function versionValues(version: EvaluatorVersion): typeof evaluatorVersions.$inferInsert {
  return {
    evaluatorId: version.evaluatorId,
    version: version.version,
    rule: version.rule,
    severity: version.severity,
    check: version.check,
    origin: version.origin,
    sourceApproval: version.sourceApproval,
    calibration: version.calibration,
    createdBy: version.createdBy,
    createdAt: new Date(version.createdAt),
  };
}
