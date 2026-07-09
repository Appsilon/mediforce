-- Add live validation and presentation fields to cowork_sessions.
--
-- validation_result: JSONB storing {valid: boolean, errors: string[]}
--   from the last update_artifact call. NULL until the first artifact update
--   on a session that has an outputSchema.
--
-- presentation: TEXT storing HTML content produced by the agent via the
--   update_presentation tool. Rendered in a sandboxed iframe in the UI.
--   NULL until the agent first calls update_presentation.

ALTER TABLE "cowork_sessions" ADD COLUMN "validation_result" jsonb;
ALTER TABLE "cowork_sessions" ADD COLUMN "presentation" text;
