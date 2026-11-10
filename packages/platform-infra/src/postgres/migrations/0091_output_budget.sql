-- How much an LLM may write per platform call: a step that scales
-- each call's built-in max output tokens. The workspace sets one; a member may
-- override it, up or down, for the calls they start in that workspace.
--
-- Additive and nullable: no value means `default`, today's limits.
ALTER TABLE "workspaces" ADD COLUMN "output_budget" text;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN "output_budget" text;
