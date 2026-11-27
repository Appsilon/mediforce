-- PR #1711 review: totalCostUsd stays "this run's own agent steps"; tree_cost_usd
-- is the whole subtree (own + every descendant, recursively), kept in sync by
-- incrementCost fanning each step's cost up the parentInstanceId chain.
-- Additive and nullable — existing runs read as null until their next step completes.
ALTER TABLE "process_instances" ADD COLUMN "tree_cost_usd" numeric(12, 6);
