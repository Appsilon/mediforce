import { and, asc, eq, sql } from 'drizzle-orm';
import {
  SkillSchema,
  SkillSummarySchema,
  parseRow,
  type Skill,
  type SkillRepository,
  type SkillSummary,
  type SkillWrite,
} from '@mediforce/platform-core';
import type { Database } from '../client';
import { skills } from '../schema/skill';

/**
 * Postgres-backed SkillRepository (ADR-0025). Parses on every read and every
 * write, for the reason the tool-catalog repository gives: `jsonb` cannot
 * enforce the shape of `files`.
 */
export class PostgresSkillRepository implements SkillRepository {
  constructor(private readonly db: Database) {}

  async getById(namespace: string, id: string): Promise<Skill | null> {
    const rows = await this.db
      .select()
      .from(skills)
      .where(and(eq(skills.workspace, namespace), eq(skills.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? toSkill(row) : null;
  }

  async list(namespace: string): Promise<SkillSummary[]> {
    const rows = await this.db
      .select({
        workspace: skills.workspace,
        id: skills.id,
        name: skills.name,
        description: skills.description,
        visibility: skills.visibility,
        contentHash: skills.contentHash,
        paths: sql<string[]>`jsonb_path_query_array(${skills.files}, '$[*].path')`,
        createdAt: skills.createdAt,
        updatedAt: skills.updatedAt,
      })
      .from(skills)
      .where(eq(skills.workspace, namespace))
      .orderBy(asc(skills.id));
    return rows.map(({ workspace, createdAt, updatedAt, ...rest }) =>
      parseRow(SkillSummarySchema, {
        ...rest,
        namespace: workspace,
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
      }),
    );
  }

  async create(skill: SkillWrite): Promise<Skill | null> {
    const { namespace, ...columns } = SkillSchema.omit({ createdAt: true, updatedAt: true }).parse(skill);
    const [row] = await this.db
      .insert(skills)
      .values({ ...columns, workspace: namespace })
      .onConflictDoNothing({ target: [skills.workspace, skills.id] })
      .returning();
    return row ? toSkill(row) : null;
  }

  async upsert(skill: SkillWrite): Promise<Skill> {
    const parsed = SkillSchema.omit({ createdAt: true, updatedAt: true }).parse(skill);
    const values = {
      name: parsed.name,
      description: parsed.description,
      visibility: parsed.visibility,
      contentHash: parsed.contentHash,
      files: parsed.files,
      // updated_at is set by the set_updated_at() trigger on every UPDATE.
    };
    const [row] = await this.db
      .insert(skills)
      .values({ workspace: parsed.namespace, id: parsed.id, ...values })
      .onConflictDoUpdate({ target: [skills.workspace, skills.id], set: values })
      .returning();
    return toSkill(row);
  }

  async delete(namespace: string, id: string): Promise<void> {
    await this.db
      .delete(skills)
      .where(and(eq(skills.workspace, namespace), eq(skills.id, id)));
  }
}

function toSkill(row: typeof skills.$inferSelect): Skill {
  return parseRow(SkillSchema, {
    namespace: row.workspace,
    id: row.id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    contentHash: row.contentHash,
    files: row.files,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
