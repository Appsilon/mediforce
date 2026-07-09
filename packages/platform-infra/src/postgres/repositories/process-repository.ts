import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  compact,
  WorkflowDefinitionSchema,
  WorkflowSourceSchema,
  WorkflowDefinitionVersionAlreadyExistsError,
  WorkflowDefinitionVersionNotFoundError,
  type ProcessRepository,
  type WorkflowDefinition,
  type WorkflowDefinitionGroup,
  type WorkflowDefinitionListResult,
  type WorkflowSource,
} from '@mediforce/platform-core';
import type { Database } from '../client';
import {
  workflowDefinitions,
  workflowMeta,
} from '../schema/workflow-definition';
import { processInstances } from '../schema/process-instance';

/**
 * Postgres-backed ProcessRepository (ADR-0001, PLAN §1.2
 * workflow_definitions + workflow_meta).
 *
 * Two tables: `workflow_definitions` holds the immutable, versioned blueprint
 * rows keyed by `unique(workspace, name, version)`; `workflow_meta` holds the
 * per (workspace, name) overlay (default-version pointer, hidden flag).
 *
 * `archived_at` / `deleted_at` are timestamp columns; the Zod schema exposes
 * them as booleans (`archived`, `deleted`) for parity with the Firestore
 * representation. The `toEntity` mapper performs the conversion on every read.
 *
 * Workspace-scoped directly via the `workspace` column on
 * workflow_definitions — no parents resolver, no instanceRepo dependency.
 *
 * Validation matches the Firestore + in-memory backends: parse on every
 * read AND every write (ADR-0001 Implementation pattern 2).
 *
 * Save semantics mirror Firestore: an existing `(workspace, name, version)`
 * triple throws WorkflowDefinitionVersionAlreadyExistsError rather than
 * overwriting. Workflow definition versions are immutable to prevent stale
 * references from running workflow instances.
 */
export class PostgresProcessRepository implements ProcessRepository {
  constructor(private readonly db: Database) {}

  async getWorkflowDefinition(
    namespace: string,
    name: string,
    version: number,
  ): Promise<WorkflowDefinition | null> {
    const rows = await this.db
      .select()
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.workspace, namespace),
          eq(workflowDefinitions.name, name),
          eq(workflowDefinitions.version, version),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const parsed = WorkflowDefinitionSchema.safeParse(toDefinition(row));
    if (parsed.success) return parsed.data;
    console.warn(
      `[process-repository] workflow_definitions parse failed for ${name}:${version}`,
      parsed.error.format(),
    );
    return null;
  }

  async saveWorkflowDefinition(definition: WorkflowDefinition): Promise<void> {
    const parsed = WorkflowDefinitionSchema.parse(definition);
    const existing = await this.db
      .select({ id: workflowDefinitions.id })
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.workspace, parsed.namespace),
          eq(workflowDefinitions.name, parsed.name),
          eq(workflowDefinitions.version, parsed.version),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new WorkflowDefinitionVersionAlreadyExistsError(
        parsed.name,
        parsed.version,
      );
    }
    await this.db.insert(workflowDefinitions).values({
      workspace: parsed.namespace,
      name: parsed.name,
      version: parsed.version,
      title: parsed.title ?? null,
      description: parsed.description ?? null,
      preamble: parsed.preamble ?? null,
      visibility: parsed.visibility,
      steps: parsed.steps,
      transitions: parsed.transitions,
      triggers: parsed.triggers,
      triggerInput: parsed.triggerInput ?? null,
      roles: parsed.roles ?? null,
      env: parsed.env ?? null,
      notifications: parsed.notifications ?? null,
      gitWorkspace: parsed.workspace ?? null,
      metadata: parsed.metadata ?? null,
      externalSkillsRepo: parsed.externalSkillsRepo ?? null,
      url: parsed.url ?? null,
      copiedFrom: parsed.copiedFrom ?? null,
      source: parsed.source ?? null,
      inputForNextRun: parsed.inputForNextRun ?? null,
      archivedAt: parsed.archived === true ? new Date() : null,
      deletedAt: parsed.deleted === true ? new Date() : null,
      createdAt: parsed.createdAt ? new Date(parsed.createdAt) : new Date(),
    });
  }

  async listAllWorkflowDefinitions(
    includeArchived: boolean,
  ): Promise<WorkflowDefinitionListResult> {
    return this.fetchAndGroup(includeArchived, () => true);
  }

  async listWorkflowDefinitionsVisibleTo(
    allowed: readonly string[],
    includeArchived: boolean,
  ): Promise<WorkflowDefinitionListResult> {
    return this.fetchAndGroup(includeArchived, (group) => {
      const latest = group.versions.find((v) => v.version === group.latestVersion);
      if (latest === undefined) return false;
      if (latest.visibility === 'public') return true;
      return allowed.includes(latest.namespace);
    });
  }

  private async fetchAndGroup(
    includeArchived: boolean,
    predicate: (group: WorkflowDefinitionGroup) => boolean,
  ): Promise<WorkflowDefinitionListResult> {
    const rows = await this.db.select().from(workflowDefinitions);

    const grouped = new Map<string, WorkflowDefinition[]>();
    for (const row of rows) {
      if (row.deletedAt !== null) continue;
      if (!includeArchived && row.archivedAt !== null) continue;
      const parsed = WorkflowDefinitionSchema.safeParse(toDefinition(row));
      if (!parsed.success) {
        console.warn(
          `[process-repository] Invalid workflow definition row ${row.workspace}:${row.name}:${row.version}:`,
          parsed.error.format(),
        );
        continue;
      }
      const definition = parsed.data;
      const groupKey = `${definition.namespace}:${definition.name}`;
      const existing = grouped.get(groupKey) ?? [];
      existing.push(definition);
      grouped.set(groupKey, existing);
    }

    const groups = await Promise.all(
      Array.from(grouped.entries()).map(async ([_key, versions]) => {
        const namespace = versions[0].namespace;
        const name = versions[0].name;
        const latestVersion = Math.max(...versions.map((v) => v.version));
        const defaultVersion = await this.getDefaultWorkflowVersion(namespace, name);
        return { namespace, name, versions, latestVersion, defaultVersion };
      }),
    );

    return { definitions: groups.filter(predicate) };
  }

  async getDefaultWorkflowVersion(
    namespace: string,
    name: string,
  ): Promise<number | null> {
    const rows = await this.db
      .select({ defaultVersion: workflowMeta.defaultVersion })
      .from(workflowMeta)
      .where(
        and(eq(workflowMeta.workspace, namespace), eq(workflowMeta.name, name)),
      )
      .limit(1);
    return rows[0]?.defaultVersion ?? null;
  }

  async setDefaultWorkflowVersion(
    namespace: string,
    name: string,
    version: number,
  ): Promise<void> {
    await this.db
      .insert(workflowMeta)
      .values({
        workspace: namespace,
        name,
        defaultVersion: version,
      })
      .onConflictDoUpdate({
        target: [workflowMeta.workspace, workflowMeta.name],
        set: { defaultVersion: version, updatedAt: new Date() },
      });
  }

  async listWorkflowVersions(
    namespace: string,
    name: string,
  ): Promise<WorkflowDefinition[]> {
    const rows = await this.db
      .select()
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.workspace, namespace),
          eq(workflowDefinitions.name, name),
        ),
      )
      .orderBy(asc(workflowDefinitions.version));
    return rows.map((row) => {
      const parsed = WorkflowDefinitionSchema.safeParse(toDefinition(row));
      if (!parsed.success) {
        console.error(
          `[process-repository] workflow_definitions parse failed for ${name}:${row.version}`,
          parsed.error.format(),
        );
        throw parsed.error;
      }
      return parsed.data;
    });
  }

  async getLatestWorkflowVersion(
    namespace: string,
    name: string,
  ): Promise<number> {
    const rows = await this.db
      .select({ version: workflowDefinitions.version })
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.workspace, namespace),
          eq(workflowDefinitions.name, name),
        ),
      )
      .orderBy(desc(workflowDefinitions.version))
      .limit(1);
    return rows[0]?.version ?? 0;
  }

  async setProcessArchived(
    name: string,
    namespace: string,
    archived: boolean,
  ): Promise<void> {
    await this.db
      .update(workflowDefinitions)
      .set({ archivedAt: archived ? new Date() : null })
      .where(
        and(
          eq(workflowDefinitions.name, name),
          eq(workflowDefinitions.workspace, namespace),
        ),
      );
  }

  async setVersionArchived(
    namespace: string,
    name: string,
    version: number,
    archived: boolean,
  ): Promise<void> {
    const rows = await this.db
      .select({ id: workflowDefinitions.id })
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.workspace, namespace),
          eq(workflowDefinitions.name, name),
          eq(workflowDefinitions.version, version),
        ),
      )
      .limit(1);
    if (rows.length === 0) {
      throw new WorkflowDefinitionVersionNotFoundError(name, version);
    }
    await this.db
      .update(workflowDefinitions)
      .set({ archivedAt: archived ? new Date() : null })
      .where(eq(workflowDefinitions.id, rows[0].id));
  }

  async setWorkflowVisibility(
    name: string,
    namespace: string,
    visibility: 'public' | 'private',
  ): Promise<void> {
    const rows = await this.db
      .select({ id: workflowDefinitions.id })
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.name, name),
          eq(workflowDefinitions.workspace, namespace),
        ),
      );
    if (rows.length === 0) {
      throw new Error(`Workflow '${name}' not found`);
    }
    await this.db
      .update(workflowDefinitions)
      .set({ visibility })
      .where(
        inArray(
          workflowDefinitions.id,
          rows.map((r) => r.id),
        ),
      );
  }

  async setWorkflowDeleted(
    namespace: string,
    name: string,
    deleted: boolean,
  ): Promise<void> {
    await this.db
      .update(workflowDefinitions)
      .set({ deletedAt: deleted ? new Date() : null })
      .where(
        and(
          eq(workflowDefinitions.name, name),
          eq(workflowDefinitions.workspace, namespace),
        ),
      );
    // Mirror Firestore: also touch the meta doc if it exists.
    await this.db
      .update(workflowMeta)
      .set({ updatedAt: new Date() })
      .where(
        and(eq(workflowMeta.workspace, namespace), eq(workflowMeta.name, name)),
      );
  }

  async isWorkflowNameDeleted(
    namespace: string,
    name: string,
  ): Promise<boolean> {
    // Firestore semantics: any version with deleted=true marks the name
    // as deleted. Mirrored here with deleted_at IS NOT NULL.
    const rows = await this.db
      .select({ id: workflowDefinitions.id })
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.workspace, namespace),
          eq(workflowDefinitions.name, name),
          isNotNull(workflowDefinitions.deletedAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async countInstancesByDefinitionName(
    namespace: string,
    name: string,
  ): Promise<number> {
    const rows = await this.db
      .select({ id: processInstances.id })
      .from(processInstances)
      .where(
        and(
          eq(processInstances.workspace, namespace),
          eq(processInstances.definitionName, name),
        ),
      );
    return rows.length;
  }

  async transferWorkflowNamespace(
    sourceNamespace: string,
    name: string,
    targetNamespace: string,
  ): Promise<void> {
    const moved = await this.db
      .update(workflowDefinitions)
      .set({ workspace: targetNamespace })
      .where(
        and(
          eq(workflowDefinitions.name, name),
          eq(workflowDefinitions.workspace, sourceNamespace),
        ),
      )
      .returning({ id: workflowDefinitions.id });
    if (moved.length === 0) {
      throw new Error(`Workflow '${name}' not found in namespace '${sourceNamespace}'`);
    }
  }
}

/**
 * `source` is informational provenance — a row written before the shape settled
 * (e.g. the legacy `{ repo, path, ref }`) must not sink the whole definition on
 * read. Validate it best-effort and drop it when it doesn't match; the workflow
 * still loads and runs, just without a provenance record.
 */
function parseSource(raw: unknown): WorkflowSource | undefined {
  if (raw === null || raw === undefined) return undefined;
  const parsed = WorkflowSourceSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

function toDefinition(
  row: typeof workflowDefinitions.$inferSelect,
): WorkflowDefinition {
  return compact({
    namespace: row.workspace,
    name: row.name,
    version: row.version,
    visibility: row.visibility as 'public' | 'private',
    steps: row.steps,
    transitions: row.transitions,
    triggers: row.triggers,
    title: row.title ?? undefined,
    description: row.description ?? undefined,
    preamble: row.preamble ?? undefined,
    triggerInput: row.triggerInput ?? undefined,
    roles: row.roles ?? undefined,
    env: row.env ?? undefined,
    notifications: row.notifications ?? undefined,
    workspace: row.gitWorkspace ?? undefined,
    metadata: row.metadata ?? undefined,
    externalSkillsRepo: row.externalSkillsRepo ?? undefined,
    url: row.url ?? undefined,
    copiedFrom: row.copiedFrom ?? undefined,
    source: parseSource(row.source),
    inputForNextRun: row.inputForNextRun ?? undefined,
    archived: row.archivedAt !== null ? true : undefined,
    deleted: row.deletedAt !== null ? true : undefined,
    createdAt: row.createdAt !== null ? row.createdAt.toISOString() : undefined,
  }) as unknown as WorkflowDefinition;
}
