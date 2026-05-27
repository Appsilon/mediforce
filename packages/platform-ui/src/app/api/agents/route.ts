import { createRouteAdapter } from '@/lib/route-adapter';
import { createAgent, listAdapter } from '@mediforce/platform-api/handlers';
import {
  ListAgentsInputSchema,
  CreateAgentInputSchema,
  type CreateAgentInput,
} from '@mediforce/platform-api/contract';

/**
 * GET /api/agents — list visible agents.
 */
export const GET = createRouteAdapter(
  ListAgentsInputSchema,
  () => ({}),
  listAdapter('agents', (_input, scope) => scope.agentDefinitions.list()),
);

/**
 * POST /api/agents — create. Body matches `CreateAgentDefinitionInputSchema`.
 */
export const POST = createRouteAdapter<typeof CreateAgentInputSchema, CreateAgentInput>(
  CreateAgentInputSchema,
  async (req) => (await req.json().catch(() => ({}))),
  createAgent,
);
