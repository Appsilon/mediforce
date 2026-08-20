import { createRouteAdapter } from '@/lib/route-adapter';
import { askWorkflowAssistant } from '@mediforce/platform-api/handlers';
import { AskWorkflowAssistantInputSchema, type AskWorkflowAssistantInput } from '@mediforce/platform-api/contract';
import { z } from 'zod';

const AskScopedSchema = AskWorkflowAssistantInputSchema.extend({
  namespace: z.string().min(1),
});

export const POST = createRouteAdapter<
  typeof AskScopedSchema,
  AskWorkflowAssistantInput & { namespace: string }
>(
  AskScopedSchema,
  async (req) => {
    const namespace = req.nextUrl.searchParams.get('namespace');
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return { ...body, namespace: namespace ?? undefined };
  },
  askWorkflowAssistant,
);
