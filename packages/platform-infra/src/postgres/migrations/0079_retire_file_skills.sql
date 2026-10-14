-- Retire workflow-file skills and `externalSkillsRepo` (ADR-0028).
--
-- 1. A step that offered a file skill (`agent.skillsDir`, with or without
--    `agent.skill`) keeps a record of it in `agent.retiredFileSkill`
--    ("<skillsDir>/<skill>"). The schema no longer reads `skill` / `skillsDir`,
--    so stripping them would run the step without its instructions; the marker
--    makes the run fail instead, naming the skill. A `skill` with no
--    `skillsDir` was never read by the runtime and is simply dropped.
-- 2. A step that built its image through the `externalSkillsRepo` fallback (a
--    `dockerfile` without its own `repo` + `commit`, and not one the workflow
--    carries) gets that repo and commit written onto it, and any step building
--    from a repo without `repoAuth` gets the workflow's `auth`. That is exactly
--    what `resolveBuildSource` and `resolveRepoToken` resolved, so the same
--    image tag is built from the same source.
-- 3. Before either rewrite, a version it touches keeps what it looked like in
--    `legacy_definition` ({ steps, externalSkillsRepo? }, the steps verbatim), so
--    the author can compare it with the migrated steps and see which repo its
--    skills came from. Nothing in the application writes it afterwards.
-- 4. The `external_skills_repo` column goes.
--

CREATE FUNCTION pg_temp.retire_file_skill(agent jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN agent IS NULL OR NOT (agent ? 'skill' OR agent ? 'skillsDir') THEN agent
    WHEN COALESCE(agent->>'skillsDir', '') = '' THEN agent - 'skill' - 'skillsDir'
    ELSE (agent - 'skill' - 'skillsDir') || jsonb_build_object(
      'retiredFileSkill',
      concat_ws('/', rtrim(agent->>'skillsDir', '/'), NULLIF(agent->>'skill', ''))
    )
  END
$$;

-- Same collapsing as `normalizeRepoPath`: drops `.` and empty segments, folds `..`.
CREATE FUNCTION pg_temp.normalize_repo_path(path text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  segments text[] := ARRAY[]::text[];
  segment text;
BEGIN
  FOREACH segment IN ARRAY string_to_array(path, '/') LOOP
    IF segment = '' OR segment = '.' THEN CONTINUE; END IF;
    IF segment = '..' THEN
      IF cardinality(segments) = 0 THEN RETURN NULL; END IF;
      segments := segments[1:cardinality(segments) - 1];
    ELSE
      segments := segments || segment;
    END IF;
  END LOOP;
  RETURN array_to_string(segments, '/');
END
$$;

CREATE FUNCTION pg_temp.with_build_repo(config jsonb, ext jsonb, artifacts jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  dockerfile text := NULLIF(config->>'dockerfile', '');
  names_repo boolean := COALESCE(config->>'repo', '') <> '' AND COALESCE(config->>'commit', '') <> '';
BEGIN
  IF config IS NULL OR ext IS NULL OR COALESCE(ext->>'url', '') = '' OR COALESCE(ext->>'commit', '') = '' THEN
    RETURN config;
  END IF;
  IF dockerfile IS NOT NULL AND NOT names_repo AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(artifacts, '[]'::jsonb)) AS artifact
    WHERE artifact->>'path' = pg_temp.normalize_repo_path(dockerfile)
  ) THEN
    config := config || jsonb_build_object(
      'repo', COALESCE(NULLIF(config->>'repo', ''), ext->>'url'),
      'commit', COALESCE(NULLIF(config->>'commit', ''), ext->>'commit')
    );
  END IF;
  IF COALESCE(config->>'repo', '') <> '' AND NOT config ? 'repoAuth' AND COALESCE(ext->>'auth', '') <> '' THEN
    config := config || jsonb_build_object('repoAuth', ext->'auth');
  END IF;
  RETURN config;
END
$$;

ALTER TABLE "workflow_definitions" ADD COLUMN IF NOT EXISTS "legacy_definition" jsonb;

UPDATE "workflow_definitions"
SET "legacy_definition" = jsonb_build_object('steps', "steps") || CASE
      WHEN "external_skills_repo" IS NULL THEN '{}'::jsonb
      ELSE jsonb_build_object('externalSkillsRepo', "external_skills_repo")
    END,
  "steps" = (
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN step ? 'agent' THEN jsonb_set(
        step, '{agent}',
        pg_temp.with_build_repo(pg_temp.retire_file_skill(step->'agent'), "external_skills_repo", "artifacts")
      )
      WHEN step ? 'script' THEN jsonb_set(
        step, '{script}',
        pg_temp.with_build_repo(step->'script', "external_skills_repo", "artifacts")
      )
      ELSE step
    END
    ORDER BY idx
  ), '[]'::jsonb)
  FROM jsonb_array_elements("steps") WITH ORDINALITY AS t(step, idx)
)
WHERE "external_skills_repo" IS NOT NULL
   OR EXISTS (
     SELECT 1 FROM jsonb_array_elements("steps") AS s(step)
     WHERE s.step->'agent' ? 'skill' OR s.step->'agent' ? 'skillsDir'
   );

ALTER TABLE "workflow_definitions" DROP COLUMN "external_skills_repo";
