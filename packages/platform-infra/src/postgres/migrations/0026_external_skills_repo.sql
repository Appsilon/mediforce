-- Migrate workflow_definitions.repo → external_skills_repo.
--
-- The top-level `repo` field on WorkflowDefinitionBaseSchema was replaced by the
-- typed `externalSkillsRepo` field, which requires a pinned commit SHA and drops
-- the deprecated branch/directory keys the runtime never read.
--
--   1. Add the external_skills_repo column.
--   2. Copy existing repo data into it, stripping the deprecated branch and
--      directory keys.
--   3. Drop the old repo column.
--   4. Null out any migrated value that is not a valid pinned external skills
--      repo ({ url, commit }). Legacy repo allowed { url } without a commit, but
--      WorkflowDefinitionSchema now requires externalSkillsRepo.commit whenever
--      externalSkillsRepo is present, so invalid rows would fail Zod parsing and
--      vanish from workflow listings. Valid pinned http(s) repos are preserved.

ALTER TABLE "workflow_definitions" ADD COLUMN "external_skills_repo" jsonb;

UPDATE "workflow_definitions"
SET "external_skills_repo" = "repo" - 'branch' - 'directory'
WHERE "repo" IS NOT NULL;

ALTER TABLE "workflow_definitions" DROP COLUMN "repo";

UPDATE "workflow_definitions"
SET "external_skills_repo" = NULL
WHERE "external_skills_repo" IS NOT NULL
  AND (
    jsonb_typeof("external_skills_repo") <> 'object'
    OR NOT ("external_skills_repo" ? 'url')
    OR NOT ("external_skills_repo" ? 'commit')
    OR jsonb_typeof("external_skills_repo"->'url') <> 'string'
    OR jsonb_typeof("external_skills_repo"->'commit') <> 'string'
    OR "external_skills_repo"->>'url' = ''
    OR "external_skills_repo"->>'url' !~ '^https?://[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+(:[0-9]{1,5})?(/[^[:space:]]*)?$'
    OR "external_skills_repo"->>'commit' !~ '^[a-f0-9]{7,40}$'
    OR (
      "external_skills_repo" ? 'auth'
      AND jsonb_typeof("external_skills_repo"->'auth') <> 'string'
    )
  );
