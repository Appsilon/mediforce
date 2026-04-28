import { NextRequest } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter, readJsonBody } from '@/lib/route-adapter';
import {
  listAgentDefinitions,
  createAgentDefinition,
} from '@mediforce/platform-api/handlers';
import {
  ListAgentDefinitionsInputSchema,
  CreateAgentDefinitionInputContractSchema,
} from '@mediforce/platform-api/contract';

/**
 * GET /api/agent-definitions — list every registered agent definition.
 */
export const GET = createRouteAdapter(
  ListAgentDefinitionsInputSchema,
  () => ({}),
  (input) =>
    listAgentDefinitions(input, {
      agentDefinitionRepo: getPlatformServices().agentDefinitionRepo,
    }),
);

/**
 * POST /api/agent-definitions — create a new agent definition.
 */
export const POST = createRouteAdapter(
  CreateAgentDefinitionInputContractSchema,
  async (req: NextRequest) => readJsonBody(req),
  (input) =>
    createAgentDefinition(input, {
      agentDefinitionRepo: getPlatformServices().agentDefinitionRepo,
    }),
  { successStatus: 201 },
);
