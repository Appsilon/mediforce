-- An Agent may declare the JSON Schema its result must satisfy; a Step that
-- runs it inherits the schema unless it declares its own.
--
-- Additive and nullable: an agent without one declares no output schema, and
-- its steps are checked against their own schema alone.
ALTER TABLE "agents" ADD COLUMN "output_schema" jsonb;
