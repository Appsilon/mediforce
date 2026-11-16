-- Pin which Agent and which version of it ran a Workflow's agent step
-- (epic #1673). Additive and nullable: a step without an Agent, or a run
-- written before this column existed, has none.
ALTER TABLE "agent_runs" ADD COLUMN "agent_id" text;
ALTER TABLE "agent_runs" ADD COLUMN "agent_version" integer;
