import { createRouteAdapter } from '@/lib/route-adapter';
import { CreateNamespaceInputSchema } from '@mediforce/platform-api/contract';
import { createNamespace } from '@mediforce/platform-api/handlers';

export const POST = createRouteAdapter(
  CreateNamespaceInputSchema,
  async (req) => (await req.json().catch(() => ({}))) as Record<string, unknown>,
  createNamespace,
  { successStatus: 201 },
);
