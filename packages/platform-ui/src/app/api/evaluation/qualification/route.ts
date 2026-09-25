import { createRouteAdapter } from '@/lib/route-adapter';
import { getStepQualification, signStepQualification } from '@mediforce/platform-api/handlers';
import { GetStepQualificationInputSchema, SignStepQualificationInputSchema } from '@mediforce/platform-api/contract';

/**
 * GET /api/evaluation/qualification — The Step's qualification badge (ADR-0023
 * D11): Qualified, Stale or Not qualified, for its runnable version or the
 * `definitionVersion` given, with every qualification signed for it.
 */
export const GET = createRouteAdapter(
  GetStepQualificationInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    return {
      namespace: params.get('namespace') ?? undefined,
      workflowName: params.get('workflowName') ?? undefined,
      stepId: params.get('stepId') ?? undefined,
      definitionVersion: params.get('definitionVersion') ?? undefined,
    };
  },
  getStepQualification,
);

/**
 * POST /api/evaluation/qualification — A person signs a Step Qualification for
 * one variant of a finished Eval Run. Needs the workflow's `edit` verb and a
 * signed-in person; their password where password sign-in is enabled.
 */
export const POST = createRouteAdapter(
  SignStepQualificationInputSchema,
  async (req) => req.json().catch(() => ({})),
  signStepQualification,
  { successStatus: 201 },
);
