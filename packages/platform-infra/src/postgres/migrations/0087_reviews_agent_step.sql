-- A plain (non-CM3) review step can name the earlier step whose Agent Run it
-- judges, so `recordHumanVerdictScore` can still record a `human_verdict`
-- Score for it.
--
-- Additive and nullable: a task that doesn't review an earlier agent step
-- leaves this null.
ALTER TABLE "human_tasks" ADD COLUMN "reviews_agent_step" text;
