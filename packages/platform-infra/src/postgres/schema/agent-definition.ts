import { pgTable, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { workspaces } from './workspace';

/**
 * Agent definition — global-by-id catalog of agent personas (PLAN-0001
 * §1.2 agents, ADR-0001 §5.2). The Firestore collection was named
 * `agentDefinitions`; this table drops the suffix to align with the
 * canonical "Agent" glossary entry in CONTEXT.md. The code-side rename
 * of `AgentDefinitionSchema` / `AgentDefinitionRepository` is a
 * separate follow-up — until then the Postgres table is `agents` while
 * the Zod/TS surface keeps the legacy names.
 *
 * `id` is the primary key. The interface treats agents as globally
 * addressable (no workspace argument on `getById` / `listAll`); seed
 * agents reuse stable slug ids from data/seeds/agent-definitions.json
 * so wd.json `step.agentId` references stay stable across environments.
 *
 * `workspace` is nullable: built-in agents (no namespace) have it null;
 * user-created agents carry the owning workspace handle. The FK uses
 * `ON DELETE SET NULL` so dropping a workspace orphans its agents
 * rather than deleting them — historical references in instance/event
 * rows still resolve.
 *
 * Small primitive fields are lifted to columns. `mcp_servers` stays as
 * `jsonb` (variable-size map of bindings, never queried by element).
 * `skill_file_names` likewise lands in `jsonb` — Postgres `text[]`
 * round-trips awkwardly through drizzle and the column is never
 * queried by element.
 */
export const agents = pgTable(
  'agents',
  {
    id: text('id').primaryKey(),
    workspace: text('workspace').references(() => workspaces.handle, {
      onDelete: 'set null',
    }),
    kind: text('kind').notNull().default('plugin'),
    runtimeId: text('runtime_id'),
    name: text('name').notNull(),
    iconName: text('icon_name').notNull(),
    description: text('description').notNull(),
    foundationModel: text('foundation_model').notNull(),
    systemPrompt: text('system_prompt').notNull(),
    inputDescription: text('input_description').notNull(),
    outputDescription: text('output_description').notNull(),
    skillFileNames: jsonb('skill_file_names').notNull().$type<string[]>(),
    mcpServers: jsonb('mcp_servers'),
    namespace: text('namespace'),
    visibility: text('visibility').notNull().default('private'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Hot list: visibility filter + namespace lookups for listVisibleTo.
    visibilityIdx: index('agents_visibility_idx').on(table.visibility),
    namespaceIdx: index('agents_namespace_idx')
      .on(table.namespace)
      .where(sql`${table.namespace} is not null`),
  }),
);
