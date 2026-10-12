-- An agent step's run time is bounded by `agent.timeoutMinutes` alone; the
-- schema no longer has `agent.timeoutMs`. The runner already enforced the
-- minutes (defaulting to 30) while the plugin read the milliseconds, so a step
-- naming both kept the minutes; one naming only milliseconds gets them as
-- minutes, rounded up (the conversion 0024_script_step_config used).
--
-- Idempotent: a rewritten step has no timeoutMs and matches nothing.

UPDATE "workflow_definitions"
SET "steps" = (
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN step->'agent' ? 'timeoutMs'
      THEN jsonb_set(
             step,
             '{agent}',
             ((step->'agent') - 'timeoutMs')
               || jsonb_build_object(
                    'timeoutMinutes',
                    COALESCE(
                      step->'agent'->'timeoutMinutes',
                      to_jsonb(CEIL((step->'agent'->>'timeoutMs')::numeric / 60000))
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
  WHERE s.step->'agent' ? 'timeoutMs'
);
