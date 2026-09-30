import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import {
  AcceptanceCriteriaVersionSchema,
  StepQualificationSchema,
  type AcceptanceCriteriaVersion,
  type StepQualification,
  EvalRunSchema,
  EvalTrialSchema,
  EvalOptimisationSchema,
  type EvalOptimisation,
  type EvalOptimisationStatus,
  type EvalRun,
  type EvalRunStatus,
  type EvalTrial,
  type EvalTrialStatus,
  EvalCaseSchema,
  WrittenOutputSchema,
  EvalDatasetVersionSchema,
  EvaluationBriefSchema,
  EvaluatorSchema,
  EvaluatorVersionSchema,
  McpEvalPolicySchema,
  McpRecordingSchema,
  type EvalCase,
  type WrittenOutput,
  type EvalDatasetVersion,
  type EvaluatedStep,
  type EvaluationBrief,
  type EvaluationRepository,
  type Evaluator,
  type EvaluatorVersion,
  type JudgeCalibration,
  type McpEvalPolicy,
  type McpRecordedCase,
  type McpRecording,
  type McpRecordingFilter,
  type SourceApproval,
} from '@mediforce/platform-core';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Database } from '../client';
import {
  evalAcceptanceCriteria,
  evalCases,
  evalWrittenOutputs,
  evalDatasetVersions,
  evalMcpRecordings,
  evalOptimisations,
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

/** `archived` is kept in its column; the record carries it as written. */
function toWrittenOutput(row: typeof evalWrittenOutputs.$inferSelect): WrittenOutput {
  return WrittenOutputSchema.parse({ ...(row.record as object), archived: row.archived });
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

function toRecording(row: typeof evalMcpRecordings.$inferSelect): McpRecording {
  return McpRecordingSchema.parse({
    ...stepFields(row),
    id: row.id,
    caseId: row.caseId,
    server: row.server,
    tape: row.tape,
    evalRunId: row.evalRunId,
    trialId: row.trialId,
    recordedAt: row.recordedAt.toISOString(),
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

  async createWrittenOutput(writtenOutput: WrittenOutput): Promise<WrittenOutput> {
    const parsed = WrittenOutputSchema.parse(writtenOutput);
    await this.db.insert(evalWrittenOutputs).values({
      id: parsed.id,
      workspace: parsed.namespace,
      workflowName: parsed.workflowName,
      stepId: parsed.stepId,
      archived: parsed.archived,
      record: parsed,
      createdAt: new Date(parsed.createdAt),
    });
    return parsed;
  }

  async getWrittenOutput(id: string): Promise<WrittenOutput | null> {
    const [row] = await this.db.select().from(evalWrittenOutputs).where(eq(evalWrittenOutputs.id, id)).limit(1);
    return row === undefined ? null : toWrittenOutput(row);
  }

  async listWrittenOutputs(step: EvaluatedStep): Promise<WrittenOutput[]> {
    const rows = await this.db.select().from(evalWrittenOutputs)
      .where(onStep(evalWrittenOutputs, step))
      .orderBy(desc(evalWrittenOutputs.createdAt), desc(evalWrittenOutputs.id));
    return rows.map(toWrittenOutput);
  }

  async setWrittenOutputArchived(id: string, archived: boolean): Promise<void> {
    await this.db.update(evalWrittenOutputs).set({ archived }).where(eq(evalWrittenOutputs.id, id));
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

  async appendMcpRecording(recording: McpRecording): Promise<void> {
    const parsed = McpRecordingSchema.parse(recording);
    await this.db.insert(evalMcpRecordings).values({
      id: parsed.id,
      workspace: parsed.namespace,
      workflowName: parsed.workflowName,
      stepId: parsed.stepId,
      caseId: parsed.caseId,
      server: parsed.server,
      tape: parsed.tape,
      evalRunId: parsed.evalRunId,
      trialId: parsed.trialId,
      recordedAt: new Date(parsed.recordedAt),
    });
  }

  async listMcpRecordings(step: EvaluatedStep, filter: McpRecordingFilter = {}): Promise<McpRecording[]> {
    const query = this.db.select().from(evalMcpRecordings)
      .where(and(
        onStep(evalMcpRecordings, step),
        filter.caseId === undefined ? undefined : eq(evalMcpRecordings.caseId, filter.caseId),
        filter.server === undefined ? undefined : eq(evalMcpRecordings.server, filter.server),
      ))
      .orderBy(desc(evalMcpRecordings.recordedAt), desc(evalMcpRecordings.id));
    const rows = filter.limit === undefined ? await query : await query.limit(filter.limit);
    return rows.reverse().map(toRecording);
  }

  async listMcpRecordedCases(step: EvaluatedStep): Promise<McpRecordedCase[]> {
    return this.db.selectDistinct({ server: evalMcpRecordings.server, caseId: evalMcpRecordings.caseId })
      .from(evalMcpRecordings)
      .where(onStep(evalMcpRecordings, step));
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

  async createOptimisation(optimisation: EvalOptimisation): Promise<void> {
    const parsed = EvalOptimisationSchema.parse(optimisation);
    await this.db.insert(evalOptimisations).values({
      id: parsed.id,
      workspace: parsed.namespace,
      workflowName: parsed.workflowName,
      stepId: parsed.stepId,
      status: parsed.status,
      record: parsed,
      createdAt: new Date(parsed.createdAt),
    });
  }

  async getOptimisation(id: string): Promise<EvalOptimisation | null> {
    const [row] = await this.db.select().from(evalOptimisations).where(eq(evalOptimisations.id, id)).limit(1);
    return row === undefined ? null : EvalOptimisationSchema.parse(row.record);
  }

  async listOptimisations(step: EvaluatedStep): Promise<EvalOptimisation[]> {
    const rows = await this.db.select().from(evalOptimisations)
      .where(onStep(evalOptimisations, step))
      .orderBy(desc(evalOptimisations.createdAt), desc(evalOptimisations.id));
    return rows.map((row) => EvalOptimisationSchema.parse(row.record));
  }

  async listStaleProposingOptimisationIds(createdBefore: string): Promise<string[]> {
    const rows = await this.db.select({ id: evalOptimisations.id }).from(evalOptimisations)
      .where(and(eq(evalOptimisations.status, 'proposing'), lt(evalOptimisations.createdAt, new Date(createdBefore))));
    return rows.map((row) => row.id);
  }

  async transitionOptimisation(id: string, from: EvalOptimisationStatus, next: EvalOptimisation): Promise<boolean> {
    const parsed = EvalOptimisationSchema.parse(next);
    const rows = await this.db.update(evalOptimisations)
      .set({ status: parsed.status, record: parsed })
      .where(and(eq(evalOptimisations.id, id), eq(evalOptimisations.status, from)))
      .returning({ id: evalOptimisations.id });
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
