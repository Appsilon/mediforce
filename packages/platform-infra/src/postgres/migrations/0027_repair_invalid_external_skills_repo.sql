-- Repair workflow definitions made invalid by 0026.
--
-- 0026 copied legacy workflow_definitions.repo into external_skills_repo.
-- Legacy repo allowed { url } without a commit, but WorkflowDefinitionSchema
-- now requires externalSkillsRepo.commit whenever externalSkillsRepo is present.
-- Rows with external_skills_repo = {"url": "..."} therefore fail Zod parsing and
-- disappear from workflow listings. Clear invalid or questionable migrated
-- values; valid pinned http(s) external skills repos are preserved.

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
