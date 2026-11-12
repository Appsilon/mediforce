-- The model a call nobody saved uses (assistants, cowork chat, voice synthesis)
-- and the one new agents, steps and judges start on. The workspace sets one; a
-- member may override it for the calls they start in that workspace.
--
-- Additive and nullable: no value means the platform default.
ALTER TABLE "workspaces" ADD COLUMN "default_model" text;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN "default_model" text;
