import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  AgentDefinitionSchema,
  parseRow,
  type AgentDefinition,
  type AgentDefinitionRepository,
  type CreateAgentDefinitionInput,
  type UpdateAgentDefinitionInput,
} from '@mediforce/platform-core';
import type { Database } from '../client';
import { agents } from '../schema/agent-definition';

/**
 * Postgres-backed AgentDefinitionRepository (ADR-0001, PLAN §1.2 agents).
 *
 * `id` is the primary key — the interface treats agents as globally
 * addressable. Built-in agents (no namespace) live in rows with a null
 * `workspace` column; user-created agents carry the owning workspace
 * handle. `listVisibleTo` is pushed to SQL:
 *   `WHERE visibility = 'public' OR namespace = ANY($allowed)`.
 *
 * Created/updated timestamps are managed by Postgres (column defaults +
 * the `agents_set_updated_at` trigger). Validation matches the Firestore +
 * in-memory backends: parse on every read AND every write.
 */
export class PostgresAgentDefinitionRepository implements AgentDefinitionRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateAgentDefinitionInput): Promise<AgentDefinition> {
    const id = randomUUID();
    const [row] = await this.db
      .insert(agents)
      .values(toRow(id, input))
      .returning();
    return toAgent(row);
  }

  async upsert(id: string, input: CreateAgentDefinitionInput): Promise<AgentDefinition> {
    const values = toRow(id, input);
    const [row] = await this.db
      .insert(agents)
      .values(values)
      .onConflictDoUpdate({
        target: agents.id,
        set: {
          workspace: values.workspace,
          kind: values.kind,
          runtimeId: values.runtimeId,
          name: values.name,
          iconName: values.iconName,
          description: values.description,
          foundationModel: values.foundationModel,
          systemPrompt: values.systemPrompt,
          inputDescription: values.inputDescription,
          outputDescription: values.outputDescription,
          mcpServers: values.mcpServers,
          namespace: values.namespace,
          visibility: values.visibility,
          // updated_at handled by the set_updated_at trigger.
        },
      })
      .returning();
    return toAgent(row);
  }

  async getById(id: string): Promise<AgentDefinition | null> {
    const rows = await this.db.select().from(agents).where(eq(agents.id, id)).limit(1);
    const row = rows[0];
    return row ? toAgent(row) : null;
  }

  async getByIdVisibleTo(
    id: string,
    allowed: readonly string[],
  ): Promise<AgentDefinition | null> {
    const rows = await this.db
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.id, id),
          visibilityFilter(allowed),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? toAgent(row) : null;
  }

  async listAll(): Promise<AgentDefinition[]> {
    const rows = await this.db.select().from(agents);
    return rows.map(toAgent);
  }

  async listVisibleTo(allowed: readonly string[]): Promise<AgentDefinition[]> {
    const rows = await this.db
      .select()
      .from(agents)
      .where(visibilityFilter(allowed));
    return rows.map(toAgent);
  }

  async update(id: string, input: UpdateAgentDefinitionInput): Promise<AgentDefinition> {
    const current = await this.getById(id);
    if (!current) {
      throw new Error(`Agent definition ${id} not found`);
    }
    const merged: AgentDefinition = AgentDefinitionSchema.parse({
      ...current,
      ...input,
      id,
    });
    const [row] = await this.db
      .update(agents)
      .set({
        kind: merged.kind,
        runtimeId: merged.runtimeId ?? null,
        name: merged.name,
        iconName: merged.iconName,
        description: merged.description,
        foundationModel: merged.foundationModel,
        systemPrompt: merged.systemPrompt,
        inputDescription: merged.inputDescription,
        outputDescription: merged.outputDescription,
        mcpServers: merged.mcpServers ?? null,
        namespace: merged.namespace ?? null,
        visibility: merged.visibility,
        // updated_at handled by the set_updated_at trigger.
      })
      .where(eq(agents.id, id))
      .returning();
    return toAgent(row);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(agents).where(eq(agents.id, id));
  }
}

function visibilityFilter(allowed: readonly string[]) {
  if (allowed.length === 0) {
    return eq(agents.visibility, 'public');
  }
  return or(
    eq(agents.visibility, 'public'),
    and(
      sql`${agents.namespace} is not null`,
      inArray(agents.namespace, allowed as string[]),
    ),
  );
}

function toRow(id: string, input: CreateAgentDefinitionInput) {
  // CreateAgentDefinitionInputSchema = AgentDefinitionSchema.omit({id, createdAt, updatedAt})
  // so defaults like kind='plugin', visibility='private' are applied during input parsing.
  // We parse here defensively in case the caller hand-built the input.
  const parsed = AgentDefinitionSchema.parse({
    ...input,
    id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  return {
    id,
    workspace: parsed.namespace ?? null,
    kind: parsed.kind,
    runtimeId: parsed.runtimeId ?? null,
    name: parsed.name,
    iconName: parsed.iconName,
    description: parsed.description,
    foundationModel: parsed.foundationModel,
    systemPrompt: parsed.systemPrompt,
    inputDescription: parsed.inputDescription,
    outputDescription: parsed.outputDescription,
    mcpServers: parsed.mcpServers ?? null,
    namespace: parsed.namespace ?? null,
    visibility: parsed.visibility,
  };
}

function toAgent(row: typeof agents.$inferSelect): AgentDefinition {
  return parseRow(AgentDefinitionSchema, {
    id: row.id,
    kind: row.kind,
    name: row.name,
    iconName: row.iconName,
    description: row.description,
    foundationModel: row.foundationModel,
    systemPrompt: row.systemPrompt,
    inputDescription: row.inputDescription,
    outputDescription: row.outputDescription,
    visibility: row.visibility,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    runtimeId: row.runtimeId ?? undefined,
    mcpServers: row.mcpServers ?? undefined,
    namespace: row.namespace ?? undefined,
  });
}

