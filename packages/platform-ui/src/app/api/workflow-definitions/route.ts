import { NextRequest } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter, readJsonBody } from '@/lib/route-adapter';
import {
  listWorkflowDefinitions,
  createWorkflowDefinition,
} from '@mediforce/platform-api/handlers';
import {
  ListWorkflowDefinitionsInputSchema,
  CreateWorkflowDefinitionInputSchema,
} from '@mediforce/platform-api/contract';

/**
 * GET /api/workflow-definitions — list every registered workflow grouped by name.
 */
export const GET = createRouteAdapter(
  ListWorkflowDefinitionsInputSchema,
  () => ({}),
  (input) =>
    listWorkflowDefinitions(input, { processRepo: getPlatformServices().processRepo }),
);

/**
 * POST /api/workflow-definitions?namespace=handle
 *
 * Registers a new version of a WorkflowDefinition. `version` and `createdAt`
 * are assigned server-side; the caller supplies everything else.
 */
export const POST = createRouteAdapter(
  CreateWorkflowDefinitionInputSchema,
  async (req: NextRequest) => {
    const namespace = req.nextUrl.searchParams.get('namespace') ?? '';
    const draft = await readJsonBody(req);
    return { namespace, draft };
  },
  (input) =>
    createWorkflowDefinition(input, { processRepo: getPlatformServices().processRepo }),
);
