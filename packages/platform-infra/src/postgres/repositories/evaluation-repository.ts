import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import {
  AcceptanceCriteriaVersionSchema,
  StepQualificationSchema,
  type AcceptanceCriteriaVersion,
  type StepQualification,
  EvalRunAcceptanceSchema,
  EvalRunSchema,
  EvalTrialSchema,
  type EvalRun,
  type EvalRunAcceptance,
  type EvalRunStatus,
  type EvalTrial,
  type EvalTrialStatus,
  EvalCaseSchema,
  EvalDatasetVersionSchema,
  EvaluationBriefSchema,
  EvaluatorSchema,
  EvaluatorVersionSchema,
  McpEvalPolicySchema,
  McpRecordingSchema,
  type EvalCase,
  type EvalDatasetVersion,
  type EvaluationOwner,
  type EvaluationSubject,
  evaluationOwnerOf,
  type EvaluationBrief,
  type EvaluationRepository,
  type Evaluator,
  type EvaluatorVersion,
  type McpEvalPolicy,
  type McpRecordedCase,
  type McpRecordedCaseFilter,
  type McpRecording,
  type McpRecordingFilter,
  type SourceApproval,
} from '@mediforce/platform-core';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Database } from '../client';
import {
  evalAcceptanceCriteria,
  evalCases,
  evalDatasetVersions,
  evalMcpRecordings,
  evalRuns,
  evalTrials,
  evaluationBriefs,
  evaluatorVersions,
  evaluators,
  mcpEvalPolicies,
  stepQualifications,
} from '../schema/evaluation';

type OwnerColumns = {
  workspace: PgColumn;
  workflowName: PgColumn;
  stepId: PgColumn;
  agentId: PgColumn;
};

/**
 * The owner as stored: the columns a row does not use hold `''`, never null,
 * so they stay in the primary keys (see the schema).
 */
function ownerColumns(owner: EvaluationOwner): { workspace: string; workflowName: string; stepId: string; agentId: string } {
  return {
    workspace: owner.namespace,
    workflowName: owner.workflowName ?? '',
    stepId: owner.stepId ?? '',
    agentId: owner.agentId ?? '',
  };
}

function ownedBy(table: OwnerColumns, subject: EvaluationSubject) {
  const owner = ownerColumns(evaluationOwnerOf(subject));
  return and(
    eq(table.workspace, owner.workspace),
    eq(table.workflowName, owner.workflowName),
    eq(table.stepId, owner.stepId),
    eq(table.agentId, owner.agentId),
  );
}

function ownerFields(row: { workspace: string; workflowName: string; stepId: string; agentId: string }): EvaluationOwner {
  return {
    namespace: row.workspace,
    workflowName: row.workflowName === '' ? null : row.workflowName,
    stepId: row.stepId === '' ? null : row.stepId,
    agentId: row.agentId === '' ? null : row.agentId,
  };
}

function toBrief(row: typeof evaluationBriefs.$inferSelect): EvaluationBrief {
  return EvaluationBriefSchema.parse({
    ...ownerFields(row),
    version: row.version,
    text: row.text,
    origin: row.origin,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  });
}

function toEvaluator(row: typeof evaluators.$inferSelect): Evaluator {
  return EvaluatorSchema.parse({
    ...ownerFields(row),
    id: row.id,
    name: row.name,
    archived: row.archived,
    runInProduction: row.runInProduction,
    onError: row.onError,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  });
}

function toVersion(row: typeof evaluatorVersions.$inferSelect): EvaluatorVersion {
  return EvaluatorVersionSchema.parse({
    evaluatorId: row.evaluatorId,
    version: row.version,
    rule: row.rule,
    check: row.check,
    origin: row.origin,
    sourceApproval: row.sourceApproval,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  });
}

function toCase(row: typeof evalCases.$inferSelect): EvalCase {
  return EvalCaseSchema.parse({
    ...ownerFields(row),
    id: row.id,
    name: row.name,
    input: row.input,
    workspaceSeedCommit: row.workspaceSeedCommit,
    expectation: row.expectation,
    expectedOutput: row.expectedOutput,
    comparison: row.comparison,
    agreementInstructions: row.agreementInstructions,
    evaluatorIds: row.evaluatorIds,
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
    ...ownerFields(row),
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
    ...ownerFields(row),
    servers: row.servers,
    env: row.env,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt.toISOString(),
  });
}

function toRecording(row: typeof evalMcpRecordings.$inferSelect): McpRecording {
  return McpRecordingSchema.parse({
    ...ownerFields(row),
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
    ...ownerFields(row),
    id: row.id,
    definitionVersion: row.definitionVersion,
    agentVersion: row.agentVersion,
    suiteAgentId: row.suiteAgentId,
    datasetVersionId: row.datasetVersionId,
    caseIds: row.caseIds,
    trialsPerCase: row.trialsPerCase,
    concurrency: row.concurrency,
    evaluators: row.evaluators,
    fingerprint: row.fingerprint,
    acceptanceCriteria: row.acceptanceCriteria,
    mcpPolicy: row.mcpPolicy,
    env: row.env,
    estimate: row.estimate,
    budgetUsd: row.budgetUsd,
    spentUsd: row.spentUsd,
    status: row.status,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    acceptance: row.acceptance,
  });
}

function toCriteria(row: typeof evalAcceptanceCriteria.$inferSelect): AcceptanceCriteriaVersion {
  return AcceptanceCriteriaVersionSchema.parse({
    ...ownerFields(row),
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
      ...ownerColumns(parsed),
      version: parsed.version,
      text: parsed.text,
      origin: parsed.origin,
      createdBy: parsed.createdBy,
      createdAt: new Date(parsed.createdAt),
    }).returning();
    return toBrief(row!);
  }

  async listBriefs(subject: EvaluationSubject): Promise<EvaluationBrief[]> {
    const rows = await this.db.select().from(evaluationBriefs)
      .where(ownedBy(evaluationBriefs, subject))
      .orderBy(desc(evaluationBriefs.version));
    return rows.map(toBrief);
  }

  async createEvaluator(evaluator: Evaluator, firstVersion: EvaluatorVersion): Promise<void> {
    const parsed = EvaluatorSchema.parse(evaluator);
    const version = EvaluatorVersionSchema.parse(firstVersion);
    await this.db.transaction(async (tx) => {
      await tx.insert(evaluators).values({
        id: parsed.id,
        ...ownerColumns(parsed),
        name: parsed.name,
        archived: parsed.archived,
        runInProduction: parsed.runInProduction,
        onError: parsed.onError,
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

  async listEvaluators(subject: EvaluationSubject): Promise<Evaluator[]> {
    const rows = await this.db.select().from(evaluators)
      .where(ownedBy(evaluators, subject))
      .orderBy(asc(evaluators.name));
    return rows.map(toEvaluator);
  }

  async setEvaluatorArchived(id: string, archived: boolean): Promise<void> {
    await this.db.update(evaluators).set({ archived }).where(eq(evaluators.id, id));
  }

  async setEvaluatorProduction(id: string, settings: Pick<Evaluator, 'runInProduction' | 'onError'>): Promise<void> {
    await this.db.update(evaluators).set(settings).where(eq(evaluators.id, id));
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

  async createCase(evalCase: EvalCase): Promise<EvalCase> {
    const parsed = EvalCaseSchema.parse(evalCase);
    const [row] = await this.db.insert(evalCases).values({
      id: parsed.id,
      ...ownerColumns(parsed),
      name: parsed.name,
      input: parsed.input,
      workspaceSeedCommit: parsed.workspaceSeedCommit,
      expectation: parsed.expectation,
      expectedOutput: parsed.expectedOutput,
      comparison: parsed.comparison,
      agreementInstructions: parsed.agreementInstructions,
      evaluatorIds: parsed.evaluatorIds,
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

  async listCases(subject: EvaluationSubject): Promise<EvalCase[]> {
    const rows = await this.db.select().from(evalCases)
      .where(ownedBy(evalCases, subject))
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
      ...ownerColumns(parsed),
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

  async listDatasetVersions(subject: EvaluationSubject): Promise<EvalDatasetVersion[]> {
    const rows = await this.db.select().from(evalDatasetVersions)
      .where(ownedBy(evalDatasetVersions, subject))
      .orderBy(desc(evalDatasetVersions.version));
    return rows.map(toDataset);
  }

  async getMcpPolicy(subject: EvaluationSubject): Promise<McpEvalPolicy | null> {
    const [row] = await this.db.select().from(mcpEvalPolicies).where(ownedBy(mcpEvalPolicies, subject)).limit(1);
    return row === undefined ? null : toPolicy(row);
  }

  async putMcpPolicy(policy: McpEvalPolicy): Promise<McpEvalPolicy> {
    const parsed = McpEvalPolicySchema.parse(policy);
    const values = {
      ...ownerColumns(parsed),
      servers: parsed.servers,
      env: parsed.env,
      updatedBy: parsed.updatedBy,
      updatedAt: new Date(parsed.updatedAt),
    };
    const [row] = await this.db.insert(mcpEvalPolicies).values(values)
      .onConflictDoUpdate({
        target: [mcpEvalPolicies.workspace, mcpEvalPolicies.workflowName, mcpEvalPolicies.stepId, mcpEvalPolicies.agentId],
        set: { servers: values.servers, env: values.env, updatedBy: values.updatedBy, updatedAt: values.updatedAt },
      })
      .returning();
    return toPolicy(row!);
  }

  async appendMcpRecording(recording: McpRecording): Promise<void> {
    const parsed = McpRecordingSchema.parse(recording);
    await this.db.insert(evalMcpRecordings).values({
      id: parsed.id,
      ...ownerColumns(parsed),
      caseId: parsed.caseId,
      server: parsed.server,
      tape: parsed.tape,
      evalRunId: parsed.evalRunId,
      trialId: parsed.trialId,
      recordedAt: new Date(parsed.recordedAt),
    });
  }

  async listMcpRecordings(subject: EvaluationSubject, filter: McpRecordingFilter = {}): Promise<McpRecording[]> {
    const query = this.db.select().from(evalMcpRecordings)
      .where(and(
        ownedBy(evalMcpRecordings, subject),
        filter.caseId === undefined ? undefined : eq(evalMcpRecordings.caseId, filter.caseId),
        filter.server === undefined ? undefined : eq(evalMcpRecordings.server, filter.server),
      ))
      .orderBy(desc(evalMcpRecordings.recordedAt), desc(evalMcpRecordings.id));
    const rows = filter.limit === undefined ? await query : await query.limit(filter.limit);
    return rows.reverse().map(toRecording);
  }

  async listMcpRecordedCases(subject: EvaluationSubject, filter: McpRecordedCaseFilter = {}): Promise<McpRecordedCase[]> {
    return this.db.selectDistinct({ server: evalMcpRecordings.server, caseId: evalMcpRecordings.caseId })
      .from(evalMcpRecordings)
      .where(and(
        ownedBy(evalMcpRecordings, subject),
        filter.evalRunId === undefined ? undefined : eq(evalMcpRecordings.evalRunId, filter.evalRunId),
      ));
  }
  async appendAcceptanceCriteria(criteria: AcceptanceCriteriaVersion): Promise<AcceptanceCriteriaVersion> {
    const parsed = AcceptanceCriteriaVersionSchema.parse(criteria);
    const [row] = await this.db.insert(evalAcceptanceCriteria).values({
      ...ownerColumns(parsed),
      version: parsed.version,
      criteria: parsed.criteria,
      origin: parsed.origin,
      createdBy: parsed.createdBy,
      createdAt: new Date(parsed.createdAt),
    }).returning();
    return toCriteria(row!);
  }

  async listAcceptanceCriteria(subject: EvaluationSubject): Promise<AcceptanceCriteriaVersion[]> {
    const rows = await this.db.select().from(evalAcceptanceCriteria)
      .where(ownedBy(evalAcceptanceCriteria, subject))
      .orderBy(desc(evalAcceptanceCriteria.version));
    return rows.map(toCriteria);
  }

  async createQualification(qualification: StepQualification): Promise<StepQualification> {
    const parsed = StepQualificationSchema.parse(qualification);
    await this.db.insert(stepQualifications).values({
      id: parsed.id,
      ...ownerColumns(parsed),
      evalRunId: parsed.evalRunId,
      fingerprint: parsed.fingerprint.hash,
      record: parsed,
      signedBy: parsed.signature.signerId,
      signedAt: new Date(parsed.signature.signedAt),
    });
    return parsed;
  }

  async listQualifications(subject: EvaluationSubject): Promise<StepQualification[]> {
    const rows = await this.db.select().from(stepQualifications)
      .where(ownedBy(stepQualifications, subject))
      .orderBy(desc(stepQualifications.signedAt), desc(stepQualifications.id));
    return rows.map((row) => StepQualificationSchema.parse(row.record));
  }

  async createEvalRun(run: EvalRun, trials: readonly EvalTrial[]): Promise<void> {
    const parsed = EvalRunSchema.parse(run);
    await this.db.transaction(async (tx) => {
      await tx.insert(evalRuns).values({
        id: parsed.id,
        ...ownerColumns(parsed),
        definitionVersion: parsed.definitionVersion,
        agentVersion: parsed.agentVersion,
        suiteAgentId: parsed.suiteAgentId,
        datasetVersionId: parsed.datasetVersionId,
        caseIds: parsed.caseIds,
        trialsPerCase: parsed.trialsPerCase,
        concurrency: parsed.concurrency,
        evaluators: parsed.evaluators,
        fingerprint: parsed.fingerprint,
        acceptanceCriteria: parsed.acceptanceCriteria,
        mcpPolicy: parsed.mcpPolicy,
        env: parsed.env,
        estimate: parsed.estimate,
        budgetUsd: parsed.budgetUsd,
        spentUsd: parsed.spentUsd,
        status: parsed.status,
        createdBy: parsed.createdBy,
        createdAt: new Date(parsed.createdAt),
        startedAt: parsed.startedAt === null ? null : new Date(parsed.startedAt),
        completedAt: parsed.completedAt === null ? null : new Date(parsed.completedAt),
        acceptance: parsed.acceptance,
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

  async listEvalRuns(subject: EvaluationSubject): Promise<EvalRun[]> {
    const rows = await this.db.select().from(evalRuns)
      .where(ownedBy(evalRuns, subject))
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

  async setEvalRunAcceptance(id: string, acceptance: EvalRunAcceptance): Promise<void> {
    await this.db.update(evalRuns).set({ acceptance: EvalRunAcceptanceSchema.parse(acceptance) }).where(eq(evalRuns.id, id));
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
    check: version.check,
    origin: version.origin,
    sourceApproval: version.sourceApproval,
    createdBy: version.createdBy,
    createdAt: new Date(version.createdAt),
  };
}
