-- Issue #1377: the capability probe now asks for `sh`, the binary the engine
-- actually runs a `runtime: bash` step with, alongside `bash`. Every cached
-- result predates that question, and a `known` result is never re-probed
-- (`refreshEntryCapabilities`) — so without this, a catalogued `alpine` keeps
-- `runtimes: []` forever and stays filtered out of the one step type it is the
-- default for.
--
-- `sh` is recorded rather than re-probed, because the stored answer already
-- proves it. The probe is `docker run --entrypoint sh <image> -c '<loop>'`, and
-- `probeLocalImageCapabilities` returns `unknown` whenever that produces no
-- stdout — an image with no shell cannot start the container at all (`exec:
-- "sh": executable file not found`, empty stdout). So a `known` row is itself
-- evidence that `sh` ran on that image's PATH; writing it down is recording a
-- fact the probe demonstrated and failed to ask about, not asserting a new one.
--
-- This keeps every other probed fact — `agentCapable`, the other runtimes — so
-- no entry passes through `unknown` on the way, and the curation #1298 added to
-- the agent picker never lapses. An `unknown` row is left alone: it never ran.
--
-- The rebuilt array is ordered like `ImageRuntimeSchema.options`, which is the
-- order `parseImageCapabilities` emits, so a patched row and a freshly probed
-- one are byte-identical rather than merely equivalent. Idempotent: the `WHERE`
-- matches only rows with a `known` version that is still missing `sh`.
UPDATE "image_catalog_entries" AS entry
SET "capabilities" = (
	SELECT jsonb_object_agg(
		cached.key,
		CASE WHEN cached.value->>'status' = 'known'
			THEN jsonb_set(cached.value, '{runtimes}', (
				SELECT coalesce(jsonb_agg(probed.runtime ORDER BY probed.position), '[]'::jsonb)
				FROM unnest(
					ARRAY['claude', 'opencode', 'bash', 'sh', 'python3', 'Rscript', 'node']
				) WITH ORDINALITY AS probed(runtime, position)
				WHERE probed.runtime = 'sh'
					OR jsonb_exists(cached.value->'runtimes', probed.runtime)
			))
			ELSE cached.value
		END
	)
	FROM jsonb_each(entry."capabilities") AS cached
)
WHERE EXISTS (
	SELECT 1
	FROM jsonb_each(entry."capabilities") AS cached
	WHERE cached.value->>'status' = 'known'
		AND NOT jsonb_exists(cached.value->'runtimes', 'sh')
);
