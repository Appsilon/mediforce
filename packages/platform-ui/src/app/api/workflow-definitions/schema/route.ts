import { createRouteAdapter } from '@/lib/route-adapter';
import { getWorkflowSchema } from '@mediforce/platform-api/handlers';
import { GetWorkflowSchemaInputSchema } from '@mediforce/platform-api/contract';

export const GET = createRouteAdapter(GetWorkflowSchemaInputSchema, () => ({}), getWorkflowSchema);
