import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  boolean,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { workspaces } from './workspace';

/**
 * Workflow definition — versioned, namespace-scoped workflow blueprint
 * (PLAN-0001 §1.2 workflow_definitions + workflow_meta, ADR-0001 §5.2 #11).
 *
 * Versions are immutable: `saveWorkflowDefinition` rejects an existing
 * `(workspace, name, version)` triple with WorkflowDefinitionVersionAlreadyExistsError.
 * `archived_at` + `deleted_at` are soft-state tombstones the Zod schema
 * exposes as booleans (`archived`, `deleted`) for Firestore parity.
 *
 * `id` is a synthetic `uuid` (no Firestore equivalent — the Firestore impl
 * uses `${namespace}:${name}:${version}` composite document ids and never
 * surfaces a standalone identifier on the WorkflowDefinition schema). The
 * authoritative key is `unique(workspace, name, version)`.
 *
 * The `workspace` column mirrors the `namespace` field on the
 * WorkflowDefinition Zod schema (FK to workspaces.handle — same pattern
 * as process_instances). Direct workspace-scoped — no parents resolver.
 *
 * Partial indexes exclude tombstoned + archived rows so the hot list query
 * (workspace + name, latest version first) stays narrow. A second partial
 * index covers the public-visibility cross-tenant feed.
 */
export const workflowDefinitions = pgTable(
  'workflow_definitions',
  {
    id: text('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspace: text('workspace')
      .notNull()
      .references(() => workspaces.handle, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    version: integer('version').notNull(),

    title: text('title'),
    description: text('description'),
    preamble: text('preamble'),

    visibility: text('visibility').notNull().default('private'),

    steps: jsonb('steps').notNull(),
    transitions: jsonb('transitions').notNull(),
    triggers: jsonb('triggers').notNull(),
    triggerInput: jsonb('trigger_input'),

    roles: jsonb('roles'),
    env: jsonb('env'),
    notifications: jsonb('notifications'),
    gitWorkspace: jsonb('git_workspace'),
    metadata: jsonb('metadata'),
    repo: jsonb('repo'),
    url: text('url'),
    copiedFrom: jsonb('copied_from'),
    source: jsonb('source'),
    inputForNextRun: jsonb('input_for_next_run'),

    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    nameVersionUnique: uniqueIndex(
      'workflow_definitions_workspace_name_version_unique',
    ).on(table.workspace, table.name, table.version),
    // Hot list: latest live version per (workspace, name).
    liveLatestIdx: index('workflow_definitions_live_latest_idx')
      .on(table.workspace, table.name, table.version.desc())
      .where(sql`${table.deletedAt} is null and ${table.archivedAt} is null`),
    // Public cross-tenant feed.
    publicIdx: index('workflow_definitions_public_idx')
      .on(table.visibility, table.workspace, table.name)
      .where(
        sql`${table.deletedAt} is null and ${table.visibility} = 'public'`,
      ),
  }),
);

/**
 * Workflow meta — per (workspace, name) overlay carrying the default-version
 * pointer and the `hidden` flag. Mirrors Firestore's `workflowMeta`
 * collection. Lives in its own table because Firestore stores it under a
 * separate document and the migration preserves that shape verbatim.
 *
 * Composite primary key `(workspace, name)` — no synthetic id. Soft-mutable
 * via `setDefaultWorkflowVersion`; carries `updated_at` + a `set_updated_at`
 * trigger so the Firestore-style "last touched" timestamp is preserved.
 */
export const workflowMeta = pgTable(
  'workflow_meta',
  {
    workspace: text('workspace')
      .notNull()
      .references(() => workspaces.handle, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    defaultVersion: integer('default_version'),
    hidden: boolean('hidden').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspace, table.name] }),
  }),
);
