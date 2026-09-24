import { createRouteAdapter } from '@/lib/route-adapter';
import { createEvalCase, listEvalCases } from '@mediforce/platform-api/handlers';
import { CreateEvalCaseInputSchema, ListEvalCasesInputSchema } from '@mediforce/platform-api/contract';

/** GET /api/evaluation/cases — The Step's Eval Cases, newest first. */
export const GET = createRouteAdapter(
  ListEvalCasesInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    return {
      namespace: params.get('namespace') ?? undefined,
      workflowName: params.get('workflowName') ?? undefined,
      stepId: params.get('stepId') ?? undefined,
      includeArchived: params.get('includeArchived') ?? undefined,
    };
  },
  listEvalCases,
);

/** POST /api/evaluation/cases — Adds a hand-written Eval Case. */
export const POST = createRouteAdapter(
  CreateEvalCaseInputSchema,
  async (req) => req.json().catch(() => ({})),
  createEvalCase,
  { successStatus: 201 },
);
