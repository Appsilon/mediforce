import { createRouteAdapter } from '@/lib/route-adapter';
import { validateWorkflow } from '@mediforce/platform-api/handlers';
import { ValidateWorkflowInputSchema } from '@mediforce/platform-api/contract';

/**
 * POST /api/workflow-definitions/validate — dry run of the canonical
 * WorkflowDefinition schema validation (no persistence). Returns
 * `{ valid, errors }`; a malformed candidate is reported as data, not a 400.
 */
export const POST = createRouteAdapter(
  ValidateWorkflowInputSchema,
  async (req) => (await req.json().catch(() => ({}))) as Record<string, unknown>,
  validateWorkflow,
);
