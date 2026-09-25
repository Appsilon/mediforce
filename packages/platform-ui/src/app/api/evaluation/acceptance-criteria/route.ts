import { createRouteAdapter } from '@/lib/route-adapter';
import { getAcceptanceCriteria, setAcceptanceCriteria } from '@mediforce/platform-api/handlers';
import { GetAcceptanceCriteriaInputSchema, SetAcceptanceCriteriaInputSchema } from '@mediforce/platform-api/contract';

/** GET /api/evaluation/acceptance-criteria — The Step's Acceptance Criteria and their versions (ADR-0023 D10). */
export const GET = createRouteAdapter(
  GetAcceptanceCriteriaInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    return {
      namespace: params.get('namespace') ?? undefined,
      workflowName: params.get('workflowName') ?? undefined,
      stepId: params.get('stepId') ?? undefined,
    };
  },
  getAcceptanceCriteria,
);

/** POST /api/evaluation/acceptance-criteria — Sets new Acceptance Criteria as a version. Needs the workflow's `edit` verb. */
export const POST = createRouteAdapter(
  SetAcceptanceCriteriaInputSchema,
  async (req) => req.json().catch(() => ({})),
  setAcceptanceCriteria,
  { successStatus: 201 },
);
