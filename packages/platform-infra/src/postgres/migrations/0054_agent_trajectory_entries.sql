-- Agent Trajectories (ADR-0023 D8): the tool calls one Agent Run made and what
-- they returned, recorded from the agent CLI's output stream. Replaces the
-- activity log the plugins wrote to a host temp file, which did not survive a
-- container restart and could not be read by the CLI or another replica.
--
-- One row per entry, numbered by the runner (the only writer per run), so the
-- batched appends during a run are plain inserts and a replayed batch is a
-- no-op on the primary key. Content follows MEDIFORCE_OTEL_CAPTURE_CONTENT
-- (ADR-0007 D5): with capture off `entry` holds only the shape.
CREATE TABLE "agent_trajectory_entries" (
  "agent_run_id" uuid NOT NULL REFERENCES "agent_runs"("id") ON DELETE CASCADE,
  "seq" integer NOT NULL,
  "entry" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_trajectory_entries_agent_run_id_seq_pk" PRIMARY KEY("agent_run_id","seq")
);--> statement-breakpoint

COMMENT ON TABLE "agent_trajectory_entries" IS
  'Agent Trajectory entries per Agent Run (ADR-0023 D8). Append-only; redacted to shape when content capture is off.';
