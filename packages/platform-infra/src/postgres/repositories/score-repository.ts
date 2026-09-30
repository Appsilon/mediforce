import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import {
  ScoreSchema,
  type ListScoresFilter,
  type Score,
  type ScoreRepository,
} from '@mediforce/platform-core';
import type { Database } from '../client';
import { scores } from '../schema/score';

type ScoreRow = typeof scores.$inferSelect;

function toScore(row: ScoreRow): Score {
  return ScoreSchema.parse({
    id: row.id,
    subject: { type: row.subjectType, id: row.subjectId },
    name: row.name,
    value: row.value,
    label: row.label,
    comment: row.comment,
    source: row.source,
    createdBy: row.createdBy,
    metadata: row.metadata,
    namespace: row.workspace,
    processInstanceId: row.processInstanceId,
    stepId: row.stepId,
    evaluatorId: row.evaluatorId,
    supersedes: row.supersedes,
    createdAt: row.createdAt.toISOString(),
  });
}

/** Postgres-backed Scores: insert-only, listed newest first. */
export class PostgresScoreRepository implements ScoreRepository {
  constructor(private readonly db: Database) {}

  async create(score: Score): Promise<Score> {
    const parsed = ScoreSchema.parse(score);
    const [row] = await this.db
      .insert(scores)
      .values({
        id: parsed.id,
        workspace: parsed.namespace,
        subjectType: parsed.subject.type,
        subjectId: parsed.subject.id,
        name: parsed.name,
        value: parsed.value,
        label: parsed.label,
        comment: parsed.comment,
        source: parsed.source,
        createdBy: parsed.createdBy,
        metadata: parsed.metadata,
        processInstanceId: parsed.processInstanceId,
        stepId: parsed.stepId,
        evaluatorId: parsed.evaluatorId,
        supersedes: parsed.supersedes,
        createdAt: new Date(parsed.createdAt),
      })
      .returning();
    return toScore(row!);
  }

  async list(filter: ListScoresFilter): Promise<Score[]> {
    return this.select(filter, []);
  }

  async listInNamespaces(allowed: readonly string[], filter: ListScoresFilter): Promise<Score[]> {
    if (allowed.length === 0) return [];
    return this.select(filter, [inArray(scores.workspace, [...allowed])]);
  }

  private async select(filter: ListScoresFilter, scope: SQL[]): Promise<Score[]> {
    const conditions: SQL[] = [...scope];
    if (filter.agentRunId !== undefined) {
      conditions.push(eq(scores.subjectType, 'agent_run'), eq(scores.subjectId, filter.agentRunId));
    }
    if (filter.processInstanceId !== undefined) conditions.push(eq(scores.processInstanceId, filter.processInstanceId));
    if (filter.stepId !== undefined) conditions.push(eq(scores.stepId, filter.stepId));
    if (filter.name !== undefined) conditions.push(eq(scores.name, filter.name));
    if (filter.evaluatorId !== undefined) conditions.push(eq(scores.evaluatorId, filter.evaluatorId));
    if (filter.source !== undefined) conditions.push(eq(scores.source, filter.source));
    if (filter.namespace !== undefined) conditions.push(eq(scores.workspace, filter.namespace));
    const rows = await this.db
      .select()
      .from(scores)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(scores.createdAt), desc(scores.id))
      .limit(filter.limit);
    return rows.map(toScore);
  }
}
