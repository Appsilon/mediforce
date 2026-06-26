import { createRouteAdapter } from '@/lib/route-adapter';
import { importWorkflow } from '@mediforce/platform-api/handlers';
import { ImportWorkflowInputSchema } from '@mediforce/platform-api/contract';

export const POST = createRouteAdapter(
  ImportWorkflowInputSchema,
  async (req) => {
    const namespace = req.nextUrl.searchParams.get('namespace');
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return { ...body, namespace: namespace ?? undefined };
  },
  importWorkflow,
  { successStatus: 201 },
);
