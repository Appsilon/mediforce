-- An Agent may declare the JSON Schema its result must satisfy; a Step that
-- runs it inherits the schema unless it declares its own.
--
-- Additive and nullable: every existing agent reads back with no output
-- schema, which is today's behaviour.
ALTER TABLE "agents" ADD COLUMN "output_schema" jsonb;
