import { createRouteAdapter } from '@/lib/route-adapter';
import { renderWorkflowDiagramHandler } from '@mediforce/platform-api/handlers';
import { RenderWorkflowDiagramInputSchema } from '@mediforce/platform-api/handlers';

/**
 * POST /api/render/workflow-diagram
 *
 * Pure-function renderer: accepts a WorkflowDefinition-like JSON body,
 * returns an HTML diagram. Authenticated via the standard route adapter.
 */
export const POST = createRouteAdapter(
  RenderWorkflowDiagramInputSchema,
  async (req) => await req.json().catch(() => ({})),
  renderWorkflowDiagramHandler,
);
