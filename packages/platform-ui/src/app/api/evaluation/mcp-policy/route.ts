import { createRouteAdapter } from '@/lib/route-adapter';
import { getMcpEvalPolicy, setMcpEvalPolicy } from '@mediforce/platform-api/handlers';
import { GetMcpEvalPolicyInputSchema, SetMcpEvalPolicyInputSchema } from '@mediforce/platform-api/contract';

/** GET /api/evaluation/mcp-policy — The Step's MCP eval policy, with defaults applied per server (ADR-0023 D6). */
export const GET = createRouteAdapter(
  GetMcpEvalPolicyInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    return {
      namespace: params.get('namespace') ?? undefined,
      workflowName: params.get('workflowName') ?? undefined,
      stepId: params.get('stepId') ?? undefined,
    };
  },
  getMcpEvalPolicy,
);

/** PUT /api/evaluation/mcp-policy — Replaces the Step's MCP eval policy. */
export const PUT = createRouteAdapter(
  SetMcpEvalPolicyInputSchema,
  async (req) => req.json().catch(() => ({})),
  setMcpEvalPolicy,
);
