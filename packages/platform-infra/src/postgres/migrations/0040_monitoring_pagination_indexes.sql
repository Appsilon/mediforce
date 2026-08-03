-- Monitoring page pagination (server-side keyset paging + aggregate KPI
-- counts, replacing full-namespace client-side fetch+filter+count).
--
-- `audit_events`: `getByNamespace`'s `WHERE workspace = ? ORDER BY
-- timestamp DESC` (Monitoring → Users / Tasks tabs) had no supporting
-- index — entity_idx and process_idx both filter on workspace but sort by
-- different trailing columns, so this read still needed a full sort over
-- every row in the workspace.
--
-- `agent_runs`: the keyset list query's `WHERE workspace = ? ORDER BY
-- started_at DESC, id DESC` (Monitoring → Agents tab) had no
-- workspace-prefixed index at all — the existing indexes are scoped to a
-- single process instance / step, not a workspace-wide scan.
--
-- `process_instances`: `workspace_status_idx` can't serve `ORDER BY
-- created_at DESC` once `status` is unconstrained (index sort order is
-- created_at *within* each status value, not across all of them) — the
-- common case for Monitoring → Workflows' default "All statuses" view.
-- Partial on `deleted_at` only (not `archived_at`) since the "Show
-- archived" toggle still needs an index-assisted scan.
CREATE INDEX "audit_events_workspace_timestamp_idx" ON "audit_events" USING btree ("workspace","timestamp" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_runs_workspace_started_idx" ON "agent_runs" USING btree ("workspace","started_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "process_instances_workspace_created_idx" ON "process_instances" USING btree ("workspace","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "deleted_at" IS NULL;
