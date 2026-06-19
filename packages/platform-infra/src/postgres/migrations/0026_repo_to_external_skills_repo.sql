-- Migrate workflow_definitions.repo → external_skills_repo.
--
-- The top-level `repo` field on WorkflowDefinitionBaseSchema has been
-- replaced by the typed `externalSkillsRepo` field (required commit SHA,
-- no deprecated branch/directory). This migration:
--
--   1. Adds the external_skills_repo column.
--   2. Copies existing repo data into it, stripping the deprecated
--      branch and directory keys that were never read by the runtime.
--   3. Nulls out the old repo column, then drops it.
--
-- Idempotent: rows with no repo value are untouched.

ALTER TABLE "workflow_definitions" ADD COLUMN "external_skills_repo" jsonb;

UPDATE "workflow_definitions"
SET "external_skills_repo" = "repo" - 'branch' - 'directory',
    "repo" = NULL
WHERE "repo" IS NOT NULL;

ALTER TABLE "workflow_definitions" DROP COLUMN "repo";
