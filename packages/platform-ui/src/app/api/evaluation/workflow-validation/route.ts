import { createRouteAdapter } from '@/lib/route-adapter';
import { getWorkflowValidation } from '@mediforce/platform-api/handlers';
import { GetWorkflowValidationInputSchema } from '@mediforce/platform-api/contract';

/**
 * GET /api/evaluation/workflow-validation — Whether each version of the
 * workflow is verified: every agent step's validation in it, newest first.
 */
export const GET = createRouteAdapter(
  GetWorkflowValidationInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    return {
      namespace: params.get('namespace') ?? undefined,
      workflowName: params.get('workflowName') ?? undefined,
    };
  },
  getWorkflowValidation,
);
