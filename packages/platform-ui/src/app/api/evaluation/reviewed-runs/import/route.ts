import { createRouteAdapter } from '@/lib/route-adapter';
import { importReviewedRuns } from '@mediforce/platform-api/handlers';
import { ImportReviewedRunsInputSchema } from '@mediforce/platform-api/contract';

/** POST /api/evaluation/reviewed-runs/import — Imports a subject's reviewed production runs as Eval Cases in bulk. */
export const POST = createRouteAdapter(
  ImportReviewedRunsInputSchema,
  (req) => req.json().catch(() => ({})),
  importReviewedRuns,
  { successStatus: 201 },
);
