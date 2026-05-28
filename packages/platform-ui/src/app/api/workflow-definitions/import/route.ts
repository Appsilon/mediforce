import { createRouteAdapter } from '@/lib/route-adapter';
import { importWorkflow } from '@mediforce/platform-api/handlers';
import { ImportWorkflowInputSchema } from '@mediforce/platform-api/contract';
import { z } from 'zod';

const ImportScopedSchema = ImportWorkflowInputSchema.extend({
  namespace: z.string().min(1),
});

/**
 * POST /api/workflow-definitions/import?namespace=… — import a workflow from a public GitHub repo.
 * Fetches the .wd.json file server-side, validates it, and registers it in the namespace.
 */
export const POST = createRouteAdapter<
  typeof ImportScopedSchema,
  z.infer<typeof ImportScopedSchema>
>(
  ImportScopedSchema,
  async (req) => {
    const namespace = req.nextUrl.searchParams.get('namespace');
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return { ...body, namespace: namespace ?? undefined };
  },
  importWorkflow,
  { successStatus: 201 },
);
