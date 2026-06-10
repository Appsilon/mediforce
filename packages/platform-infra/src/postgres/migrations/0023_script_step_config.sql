-- Move deterministic script-step config from step.agent to step.script.
--
-- The workflow definition schema no longer accepts script settings under
-- `agent` (and rejects `agent`/`autonomyLevel`/`cowork` on script steps
-- outright), and PostgresProcessRepository re-parses stored definitions on
-- every read — so old-shape rows must be rewritten in the same release the
-- code ships (precedent for jsonb step rewrites: 0017_normalize_model_ids).
--
-- For every step that is executor='script' with an `agent` config, or
-- executor='agent' wired to the script-container plugin:
--   1. executor := 'script', plugin := coalesce(plugin, 'script-container')
--   2. script  := agent filtered to the script config keys; agent.timeoutMs
--      (ms, legacy) becomes script.timeoutMinutes (ceil) when no
--      timeoutMinutes is set
--   3. agent and autonomyLevel are removed (autonomy is agent-only noise on
--      deterministic steps; the engine always forced L4 for scripts)
--
-- Idempotent: already-migrated steps carry no `agent` key and match nothing.

UPDATE "workflow_definitions"
SET "steps" = (
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN (step->>'executor' = 'script' AND step ? 'agent')
        OR (step->>'executor' = 'agent'
            AND (step->>'plugin' = 'script-container'
                 OR step->'agent' ? 'command'
                 OR step->'agent' ? 'inlineScript'))
      THEN (step - 'agent' - 'autonomyLevel')
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
      ELSE step
    END
    ORDER BY idx
  ), '[]'::jsonb)
  FROM jsonb_array_elements("steps") WITH ORDINALITY AS t(step, idx)
)
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements("steps") AS s(step)
  WHERE (s.step->>'executor' = 'script' AND s.step ? 'agent')
     OR (s.step->>'executor' = 'agent'
         AND (s.step->>'plugin' = 'script-container'
              OR s.step->'agent' ? 'command'
              OR s.step->'agent' ? 'inlineScript'))
);
