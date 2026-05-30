-- #534: legacy agent_runs rows persisted a null envelope as the jsonb
-- literal '{}' instead of SQL NULL, breaking the list read path
-- (AgentOutputEnvelopeSchema requires reasoning_summary / reasoning_chain /
-- annotations / result). Normalize the mis-stored rows to NULL. Idempotent.
UPDATE "agent_runs" SET "envelope_payload" = NULL WHERE "envelope_payload" = '{}'::jsonb;
