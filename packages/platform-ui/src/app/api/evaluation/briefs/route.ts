import { createRouteAdapter } from '@/lib/route-adapter';
import { getEvaluationBrief, setEvaluationBrief } from '@mediforce/platform-api/handlers';
import { GetEvaluationBriefInputSchema, SetEvaluationBriefInputSchema } from '@mediforce/platform-api/contract';

/** GET /api/evaluation/briefs — The Step's Evaluation Brief and its versions (ADR-0023 D16). */
export const GET = createRouteAdapter(
  GetEvaluationBriefInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    return {
      namespace: params.get('namespace') ?? undefined,
      workflowName: params.get('workflowName') ?? undefined,
      stepId: params.get('stepId') ?? undefined,
    };
  },
  getEvaluationBrief,
);

/** POST /api/evaluation/briefs — Writes a new Evaluation Brief version. Needs the workflow's `edit` verb. */
export const POST = createRouteAdapter(
  SetEvaluationBriefInputSchema,
  async (req) => req.json().catch(() => ({})),
  setEvaluationBrief,
  { successStatus: 201 },
);
