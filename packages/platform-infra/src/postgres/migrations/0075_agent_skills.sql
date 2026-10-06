-- ADR-0025 decision 4: the Skills an Agent holds, as a `jsonb` array of
-- `{ namespace, id }` references.
--
-- Additive and nullable: every existing agent reads back with no skills,
-- which is today's behaviour. The GIN index serves the "which agents hold
-- this skill" lookup that guards Skill deletes and visibility changes.
ALTER TABLE "agents" ADD COLUMN "skills" jsonb;--> statement-breakpoint
CREATE INDEX "agents_skills_idx" ON "agents" USING gin ("skills" jsonb_path_ops);
