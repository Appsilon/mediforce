import { createRouteAdapter } from '@/lib/route-adapter';
import { listWorkflows, registerWorkflow } from '@mediforce/platform-api/handlers';
import {
  ListWorkflowsInputSchema,
  RegisterWorkflowInputSchema,
  type RegisterWorkflowInput,
} from '@mediforce/platform-api/contract';
import { z } from 'zod';

/**
 * GET /api/workflow-definitions — list (visibility + namespace gated).
 */
export const GET = createRouteAdapter(
  ListWorkflowsInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    const namespace = params.get('namespace');
    // Absent => schema default (true). Only an explicit `false` turns it off,
    // mirroring the home page's "show completed" toggle.
    const includeCompletedRuns = params.get('includeCompletedRuns') === 'false' ? false : undefined;
    return {
      ...(namespace !== null ? { namespace } : {}),
      ...(includeCompletedRuns === false ? { includeCompletedRuns } : {}),
    };
  },
  listWorkflows,
);

const RegisterScopedSchema = RegisterWorkflowInputSchema.extend({
  namespace: z.string().min(1),
});

/**
 * POST /api/workflow-definitions?namespace=… — register a new workflow.
 * Auto-increments version. Mint-version race preserved (status quo);
 * conflict surfaces as 409 via ConflictError.
 */
export const POST = createRouteAdapter<typeof RegisterScopedSchema, RegisterWorkflowInput & { namespace: string }>(
  RegisterScopedSchema,
  async (req) => {
    const namespace = req.nextUrl.searchParams.get('namespace');
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return { ...body, namespace: namespace ?? undefined };
  },
  registerWorkflow,
  { successStatus: 201 },
);
