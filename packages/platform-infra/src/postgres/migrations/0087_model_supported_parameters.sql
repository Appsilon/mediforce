-- The request parameters some provider of a model takes, as OpenRouter lists
-- them. An Evaluator's judge is asked for its verdict constrained to a JSON
-- Schema only on a model that takes `structured_outputs`, and is sent no
-- parameter its model does not take — a request routed with
-- `require_parameters` would otherwise find no provider.
--
-- Additive and nullable: a model stays unknown until the next registry sync,
-- and a judge on an unknown model answers in text as before.
ALTER TABLE "model_registry_entries" ADD COLUMN "supported_parameters" jsonb;
