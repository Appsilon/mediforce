-- Normalize Firestore-encoded model IDs: replace the first "__" with "/".
--
-- Firestore doc IDs cannot contain "/" so the legacy model registry used
-- "__" as a provider/model separator (e.g. "deepseek__deepseek-chat").
-- Postgres has no such limitation.  The OpenRouter sync already writes "/"
-- format, but rows migrated from Firestore kept the "__" encoding.
--
-- Affected tables:
--   model_registry_entries.id          (PK, text)
--   workflow_definitions.steps         (JSONB — steps[*].agent.model)
--   agents.foundation_model            (text)
--   agent_runs.model                   (text)
--   cowork_sessions.model              (text)
--
-- All replacements are idempotent: rows already using "/" are untouched.

-- 1a. model_registry_entries — delete __ duplicates where / version exists
DELETE FROM "model_registry_entries" AS old
WHERE old."id" LIKE '%\_\_%' ESCAPE '\'
  AND old."id" NOT LIKE '%/%'
  AND EXISTS (
    SELECT 1 FROM "model_registry_entries" AS canonical
    WHERE canonical."id" = CONCAT(
      SUBSTRING(old."id" FROM 1 FOR POSITION('__' IN old."id") - 1),
      '/',
      SUBSTRING(old."id" FROM POSITION('__' IN old."id") + 2)
    )
  );

-- 1b. model_registry_entries — update remaining __ rows (no / conflict)
UPDATE "model_registry_entries"
SET "id" = CONCAT(
      SUBSTRING("id" FROM 1 FOR POSITION('__' IN "id") - 1),
      '/',
      SUBSTRING("id" FROM POSITION('__' IN "id") + 2)
    )
WHERE "id" LIKE '%\_\_%' ESCAPE '\'
  AND "id" NOT LIKE '%/%';

-- 2. workflow_definitions — JSONB steps[*].agent.model
UPDATE "workflow_definitions"
SET "steps" = (
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN step->'agent'->>'model' IS NOT NULL
        AND step->'agent'->>'model' LIKE '%\_\_%' ESCAPE '\'
        AND step->'agent'->>'model' NOT LIKE '%/%'
      THEN jsonb_set(
        step,
        '{agent,model}',
        to_jsonb(
          CONCAT(
            SUBSTRING(step->'agent'->>'model' FROM 1 FOR POSITION('__' IN step->'agent'->>'model') - 1),
            '/',
            SUBSTRING(step->'agent'->>'model' FROM POSITION('__' IN step->'agent'->>'model') + 2)
          )
        )
      )
      ELSE step
    END
    ORDER BY idx
  ), '[]'::jsonb)
  FROM jsonb_array_elements("steps") WITH ORDINALITY AS t(step, idx)
)
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements("steps") AS s(step)
  WHERE s.step->'agent'->>'model' LIKE '%\_\_%' ESCAPE '\'
    AND s.step->'agent'->>'model' NOT LIKE '%/%'
);

-- 3. agents.foundation_model
UPDATE "agents"
SET "foundation_model" = CONCAT(
      SUBSTRING("foundation_model" FROM 1 FOR POSITION('__' IN "foundation_model") - 1),
      '/',
      SUBSTRING("foundation_model" FROM POSITION('__' IN "foundation_model") + 2)
    )
WHERE "foundation_model" LIKE '%\_\_%' ESCAPE '\'
  AND "foundation_model" NOT LIKE '%/%';

-- 4. agent_runs.model
UPDATE "agent_runs"
SET "model" = CONCAT(
      SUBSTRING("model" FROM 1 FOR POSITION('__' IN "model") - 1),
      '/',
      SUBSTRING("model" FROM POSITION('__' IN "model") + 2)
    )
WHERE "model" LIKE '%\_\_%' ESCAPE '\'
  AND "model" NOT LIKE '%/%';

-- 5. cowork_sessions.model
UPDATE "cowork_sessions"
SET "model" = CONCAT(
      SUBSTRING("model" FROM 1 FOR POSITION('__' IN "model") - 1),
      '/',
      SUBSTRING("model" FROM POSITION('__' IN "model") + 2)
    )
WHERE "model" LIKE '%\_\_%' ESCAPE '\'
  AND "model" NOT LIKE '%/%';
