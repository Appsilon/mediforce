import { createRouteAdapter } from '@/lib/route-adapter';
import { ListNamespaceMembersInputSchema } from '@mediforce/platform-api/contract';
import { listNamespaceMembers } from '@mediforce/platform-api/handlers';

export const GET = createRouteAdapter(
  ListNamespaceMembersInputSchema,
  (req) => ({ namespace: new URL(req.url).searchParams.get('namespace') ?? '' }),
  listNamespaceMembers,
);
