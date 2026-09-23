import { and, asc, desc, eq } from 'drizzle-orm';
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
  evalCases,
  evalDatasetVersions,
  evaluationBriefs,
  evaluatorVersions,
  evaluators,
  mcpEvalPolicies,
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
