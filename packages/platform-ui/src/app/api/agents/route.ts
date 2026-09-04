import { createRouteAdapter } from '@/lib/route-adapter';
import { createAgent, listAdapter } from '@mediforce/platform-api/handlers';
import {
  ListAgentsInputSchema,
  CreateAgentInputSchema,
  type ListAgentsInput,
  type CreateAgentInput,
} from '@mediforce/platform-api/contract';

/**
 * GET /api/agents — list visible agents.
 */
export const GET = createRouteAdapter(
  ListAgentsInputSchema,
  (req) => ({ namespace: req.nextUrl.searchParams.get('namespace') ?? undefined }),
  listAdapter('agents', (input: ListAgentsInput, scope) => scope.agentDefinitions.list(input.namespace)),
);

/**
 * POST /api/agents — create. Body matches `CreateAgentDefinitionInputSchema`.
 */
export const POST = createRouteAdapter<typeof CreateAgentInputSchema, CreateAgentInput>(
  CreateAgentInputSchema,
  async (req) => (await req.json().catch(() => ({}))),
  createAgent,
  { successStatus: 201 },
);
