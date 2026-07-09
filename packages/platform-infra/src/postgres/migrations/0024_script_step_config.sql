-- Move deterministic script-step config from step.agent to step.script.
--
-- The workflow definition schema no longer accepts script settings under
-- `agent` (and rejects `agent`/`autonomyLevel`/`cowork` on script steps
-- outright), and PostgresProcessRepository re-parses stored definitions on
-- every read — so old-shape rows must be rewritten in the same release the
-- code ships (precedent for jsonb step rewrites: 0017_normalize_model_ids).
--
-- Three rewrite cases, applied per-step:
--
--   Case 1 — flip executor='agent' + (no plugin | plugin='script-container')
--     + agent has command or inlineScript → executor='script' + script: {...}
--
--   Case 2 — executor='script' + agent has command or inlineScript
--     + (no plugin | plugin='script-container') → move agent config → script
--
--   Case 3 — strip-only: executor='script' + agent without command/inlineScript
--     (image-only, empty, etc.) OR step has autonomyLevel/cowork noise →
--     remove those keys; no script key added (pre-existing data quality issue
--     in the source row, requires manual repair of script command).
--
-- executor='agent' + any other plugin is intentionally NOT touched.
-- script.timeoutMinutes is populated from agent.timeoutMs (ms → minutes, ceil)
-- when agent.timeoutMs is present and agent.timeoutMinutes is absent.
--
-- Idempotent: already-migrated steps carry no agent key and match nothing.

UPDATE "workflow_definitions"
SET "steps" = (
  SELECT COALESCE(jsonb_agg(
    CASE
      -- Case 1: flip executor='agent' + (script-container | no plugin) + has command/inlineScript
      WHEN step->>'executor' = 'agent'
        AND (step->>'plugin' IS NULL OR step->>'plugin' = 'script-container')
        AND (step->'agent' ? 'command' OR step->'agent' ? 'inlineScript')
      THEN (step - 'agent' - 'autonomyLevel' - 'cowork')
        || jsonb_build_object(
             'executor', 'script',
             'plugin', COALESCE(step->>'plugin', 'script-container'),
             'script',
               (SELECT COALESCE(jsonb_object_agg(cfg.key, cfg.value), '{}'::jsonb)
                FROM jsonb_each(step->'agent') AS cfg(key, value)
                WHERE cfg.key IN ('command', 'inlineScript', 'runtime', 'image',
                                  'dockerfile', 'repo', 'commit', 'repoAuth',
                                  'timeoutMinutes'))
               || CASE
                    WHEN step->'agent' ? 'timeoutMs'
                      AND NOT (step->'agent' ? 'timeoutMinutes')
                    THEN jsonb_build_object(
                           'timeoutMinutes',
                           CEIL((step->'agent'->>'timeoutMs')::numeric / 60000))
                    ELSE '{}'::jsonb
                  END
           )

      -- Case 2: executor='script' + (script-container | no plugin) + agent has command/inlineScript
      WHEN step->>'executor' = 'script'
        AND (step->>'plugin' IS NULL OR step->>'plugin' = 'script-container')
        AND step ? 'agent'
        AND (step->'agent' ? 'command' OR step->'agent' ? 'inlineScript')
      THEN (step - 'agent' - 'autonomyLevel' - 'cowork')
        || jsonb_build_object(
             'plugin', COALESCE(step->>'plugin', 'script-container'),
             'script',
               COALESCE(
                 step->'script',
                 (SELECT COALESCE(jsonb_object_agg(cfg.key, cfg.value), '{}'::jsonb)
                  FROM jsonb_each(step->'agent') AS cfg(key, value)
                  WHERE cfg.key IN ('command', 'inlineScript', 'runtime', 'image',
                                    'dockerfile', 'repo', 'commit', 'repoAuth',
                                    'timeoutMinutes'))
                 || CASE
                      WHEN step->'agent' ? 'timeoutMs'
                        AND NOT (step->'agent' ? 'timeoutMinutes')
                      THEN jsonb_build_object(
                             'timeoutMinutes',
                             CEIL((step->'agent'->>'timeoutMs')::numeric / 60000))
                      ELSE '{}'::jsonb
                    END
               )
           )

      -- Case 3: strip-only — executor='script' + agent without command/inlineScript
      -- (image-only config, empty, etc.) OR residual autonomyLevel/cowork.
      -- Does not add a script key; the source row was already unable to run.
      WHEN step->>'executor' = 'script'
        AND (step ? 'agent' OR step ? 'autonomyLevel' OR step ? 'cowork')
      THEN step - 'agent' - 'autonomyLevel' - 'cowork'

      ELSE step
    END
    ORDER BY idx
  ), '[]'::jsonb)
  FROM jsonb_array_elements("steps") WITH ORDINALITY AS t(step, idx)
)
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements("steps") AS s(step)
  WHERE
    (s.step->>'executor' = 'agent'
      AND (s.step->>'plugin' IS NULL OR s.step->>'plugin' = 'script-container')
      AND (s.step->'agent' ? 'command' OR s.step->'agent' ? 'inlineScript'))
    OR (s.step->>'executor' = 'script' AND s.step ? 'agent')
    OR (s.step->>'executor' = 'script'
        AND (s.step ? 'autonomyLevel' OR s.step ? 'cowork'))
);
