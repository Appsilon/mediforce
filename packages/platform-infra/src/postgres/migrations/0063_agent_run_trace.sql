-- Step Evaluation 5b (ADR-0023). The OpenTelemetry span an Agent Run was
-- traced under, so its Scores can be exported next to the trace in Phoenix or
-- Langfuse. Null when tracing is off, and for every run recorded before.
ALTER TABLE "agent_runs" ADD COLUMN "trace_id" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "span_id" text;
