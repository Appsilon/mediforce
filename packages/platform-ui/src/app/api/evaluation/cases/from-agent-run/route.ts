import { createRouteAdapter } from '@/lib/route-adapter';
import { createEvalCaseFromAgentRun } from '@mediforce/platform-api/handlers';
import { CreateEvalCaseFromAgentRunInputSchema } from '@mediforce/platform-api/contract';

/** POST /api/evaluation/cases/from-agent-run — "Add to eval set" from a production Agent Run. */
export const POST = createRouteAdapter(
  CreateEvalCaseFromAgentRunInputSchema,
  async (req) => req.json().catch(() => ({})),
  createEvalCaseFromAgentRun,
  { successStatus: 201 },
);
