-- What a production Evaluator does when its check cannot run (ADR-0023 D13):
-- `ignore` keeps today's behaviour, the run continues unchecked; `escalate`
-- sends the run to a person, as a failing check does.
ALTER TABLE "evaluators" ADD COLUMN "on_error" text DEFAULT 'ignore' NOT NULL;
