import { createRouteAdapter } from '@/lib/route-adapter';
import { createPerturbedEvalCase } from '@mediforce/platform-api/handlers';
import { CreatePerturbedEvalCaseInputSchema } from '@mediforce/platform-api/contract';

/** POST /api/evaluation/cases/perturbed — An Eval Case synthesized from a production run with deliberate changes. */
export const POST = createRouteAdapter(
  CreatePerturbedEvalCaseInputSchema,
  async (req) => req.json().catch(() => ({})),
  createPerturbedEvalCase,
  { successStatus: 201 },
);
