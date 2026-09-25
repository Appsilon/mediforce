import { createRouteAdapter } from '@/lib/route-adapter';
import { createRedTeamEvalCases } from '@mediforce/platform-api/handlers';
import { CreateRedTeamEvalCasesInputSchema } from '@mediforce/platform-api/contract';

/** POST /api/evaluation/cases/red-team — A red-team or robustness suite of Eval Cases from one production run. */
export const POST = createRouteAdapter(
  CreateRedTeamEvalCasesInputSchema,
  async (req) => req.json().catch(() => ({})),
  createRedTeamEvalCases,
  { successStatus: 201 },
);
